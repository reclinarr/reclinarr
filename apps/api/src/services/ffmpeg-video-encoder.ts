import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Live TV H.264 encoder. libx264 is always available as a fallback.
 * Hardware encoders are used only after a short probe encode succeeds:
 * VideoToolbox on macOS, VAAPI (Intel/AMD), NVENC, and Quick Sync.
 * Decode stays on the CPU; only the encode is handed to the GPU.
 */

export type HwAccelMode = "auto" | "off" | "nvenc" | "qsv" | "vaapi" | "videotoolbox";

export type LiveVideoEncoderId =
  | "libx264"
  | "h264_nvenc"
  | "h264_qsv"
  | "h264_vaapi"
  | "h264_videotoolbox";

export interface LiveVideoEncoder {
  id: LiveVideoEncoderId;
  /** Inserted before `-i`. */
  beforeInput: string[];
  /** Replaces the libx264 codec block, through the GOP flags. */
  videoArgs: string[];
}

const HW_KINDS = ["nvenc", "videotoolbox", "vaapi", "qsv"] as const;
type HwKind = (typeof HW_KINDS)[number];

const ENCODER_ID: Record<HwKind, LiveVideoEncoderId> = {
  nvenc: "h264_nvenc",
  qsv: "h264_qsv",
  vaapi: "h264_vaapi",
  videotoolbox: "h264_videotoolbox",
};

export function parseHwAccelMode(value: string | undefined): HwAccelMode {
  const v = value?.trim().toLowerCase();
  if (!v || v === "auto") return "auto";
  if (v === "off" || v === "cpu" || v === "libx264") return "off";
  if (v === "nvenc" || v === "qsv" || v === "vaapi" || v === "videotoolbox") return v;
  return "auto";
}

function keyframeExpr(hlsTime: number): string[] {
  return ["-force_key_frames", `expr:gte(t,n_forced*${hlsTime})`, "-g", "60"];
}

export function libx264Encoder(hlsTime: number): LiveVideoEncoder {
  return {
    id: "libx264",
    beforeInput: [],
    videoArgs: [
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-profile:v",
      "baseline",
      "-level",
      "3.1",
      "-pix_fmt",
      "yuv420p",
      ...keyframeExpr(hlsTime),
      "-keyint_min",
      "48",
      "-sc_threshold",
      "0",
      "-bf",
      "0",
    ],
  };
}

export function liveVideoEncoder(
  kind: HwKind,
  hlsTime: number,
  renderDevice?: string | null,
): LiveVideoEncoder {
  const keys = keyframeExpr(hlsTime);
  switch (kind) {
    case "nvenc":
      return {
        id: "h264_nvenc",
        beforeInput: [],
        videoArgs: [
          "-c:v",
          "h264_nvenc",
          "-preset",
          "p1",
          "-tune",
          "ll",
          "-profile:v",
          "baseline",
          "-level",
          "3.1",
          "-pix_fmt",
          "yuv420p",
          "-rc",
          "vbr",
          "-cq",
          "23",
          "-bf",
          "0",
          ...keys,
          "-forced-idr",
          "1",
        ],
      };
    case "qsv":
      return {
        id: "h264_qsv",
        beforeInput: [
          "-init_hw_device",
          `qsv=hw:${renderDevice}`,
          "-filter_hw_device",
          "hw",
        ],
        videoArgs: [
          "-vf",
          "hwupload=extra_hw_frames=64,format=qsv",
          "-c:v",
          "h264_qsv",
          "-preset",
          "veryfast",
          "-profile:v",
          "baseline",
          "-bf",
          "0",
          ...keys,
          "-look_ahead",
          "0",
          "-global_quality",
          "23",
        ],
      };
    case "vaapi":
      return {
        id: "h264_vaapi",
        beforeInput: ["-vaapi_device", renderDevice ?? ""],
        videoArgs: [
          "-vf",
          "format=nv12,hwupload",
          "-c:v",
          "h264_vaapi",
          "-profile:v",
          "constrained_baseline",
          "-bf",
          "0",
          "-qp",
          "23",
          ...keys,
        ],
      };
    case "videotoolbox":
      return {
        id: "h264_videotoolbox",
        beforeInput: [],
        videoArgs: [
          "-c:v",
          "h264_videotoolbox",
          "-profile:v",
          "baseline",
          // VideoToolbox enforces the level: 3.1 (≤720p30) rejects 1080p channels with -12902.
          "-level",
          "4.2",
          "-pix_fmt",
          "yuv420p",
          "-realtime",
          "1",
          "-prio_speed",
          "1",
          "-allow_sw",
          "1",
          "-b:v",
          "4500k",
          "-bf",
          "0",
          ...keys,
        ],
      };
  }
}

export interface EncoderProbeInput {
  mode: HwAccelMode;
  hlsTime: number;
  encoders: ReadonlySet<string>;
  platform: NodeJS.Platform;
  renderDevice: string | null;
  nvidia: boolean;
  smoke: (encoder: LiveVideoEncoder) => Promise<boolean>;
}

/** Pick the first hardware encoder that is present and passes `smoke`. */
export async function chooseLiveVideoEncoder(input: EncoderProbeInput): Promise<LiveVideoEncoder> {
  const software = libx264Encoder(input.hlsTime);
  if (input.mode === "off") return software;

  const order: readonly HwKind[] = input.mode === "auto" ? HW_KINDS : [input.mode];
  for (const kind of order) {
    if (!input.encoders.has(ENCODER_ID[kind])) continue;
    if (kind === "videotoolbox" && input.platform !== "darwin") continue;
    if ((kind === "vaapi" || kind === "qsv") && !input.renderDevice) continue;
    if (kind === "nvenc" && input.mode === "auto" && !input.nvidia) continue;
    const encoder = liveVideoEncoder(kind, input.hlsTime, input.renderDevice);
    if (await input.smoke(encoder)) return encoder;
  }
  return software;
}

export function parseFfmpegEncoderList(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*[VASFXBD.]{6}\s+(\S+)/);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

export function findRenderDevice(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.RECLINARR_VAAPI_DEVICE?.trim();
  if (explicit) return explicit;
  try {
    const nodes = readdirSync("/dev/dri")
      .filter((name) => name.startsWith("renderD"))
      .sort();
    return nodes[0] ? join("/dev/dri", nodes[0]) : null;
  } catch {
    return null;
  }
}

export function nvidiaVisible(env: NodeJS.ProcessEnv = process.env): boolean {
  const vis = env.NVIDIA_VISIBLE_DEVICES?.trim().toLowerCase();
  if (vis && vis !== "void" && vis !== "none") return true;
  return existsSync("/dev/nvidia0") || existsSync("/proc/driver/nvidia/version");
}

let cached: Promise<LiveVideoEncoder> | null = null;

export function resetLiveVideoEncoderCache(): void {
  cached = null;
}

export function selectLiveVideoEncoder(opts?: {
  hlsTime?: number;
  env?: NodeJS.ProcessEnv;
  bin?: string;
}): Promise<LiveVideoEncoder> {
  if (cached) return cached;
  const hlsTime = opts?.hlsTime ?? 2;
  const env = opts?.env ?? process.env;
  const bin = opts?.bin ?? (env.FFMPEG_PATH?.trim() || "ffmpeg");
  cached = detectLiveVideoEncoder(bin, env, hlsTime).catch((err) => {
    cached = null;
    console.warn("[live-hls] encoder probe failed", err);
    return libx264Encoder(hlsTime);
  });
  return cached;
}

async function detectLiveVideoEncoder(
  bin: string,
  env: NodeJS.ProcessEnv,
  hlsTime: number,
): Promise<LiveVideoEncoder> {
  const mode = parseHwAccelMode(env.RECLINARR_HWACCEL);
  const software = libx264Encoder(hlsTime);
  if (mode === "off") {
    console.info("[live-hls] live transcode encoder: libx264");
    return software;
  }

  const listed = await runProcess(bin, ["-hide_banner", "-encoders"], 5_000);
  const encoders = listed.code === 0 ? parseFfmpegEncoderList(listed.out) : new Set<string>();
  const encoder = await chooseLiveVideoEncoder({
    mode,
    hlsTime,
    encoders,
    platform: process.platform,
    renderDevice: findRenderDevice(env),
    nvidia: nvidiaVisible(env),
    smoke: async (candidate) => {
      const ok = await probeEncode(bin, candidate);
      if (!ok) console.warn(`[live-hls] ${candidate.id} unavailable, skipping`);
      return ok;
    },
  });
  console.info(`[live-hls] live transcode encoder: ${encoder.id}`);
  return encoder;
}

async function probeEncode(bin: string, encoder: LiveVideoEncoder): Promise<boolean> {
  const { code } = await runProcess(
    bin,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      ...encoder.beforeInput,
      "-f",
      "lavfi",
      "-i",
      "testsrc=s=640x360:r=25:d=0.2",
      ...encoder.videoArgs,
      "-an",
      "-f",
      "null",
      "-",
    ],
    8_000,
  );
  return code === 0;
}

function runProcess(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out });
    };
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(1);
    }, timeoutMs);
    const append = (chunk: Buffer) => {
      if (out.length < 200_000) out += chunk.toString("utf8");
    };
    proc.stdout?.on("data", append);
    proc.stderr?.on("data", append);
    proc.on("error", () => finish(1));
    proc.on("close", (code) => finish(code ?? 1));
  });
}
