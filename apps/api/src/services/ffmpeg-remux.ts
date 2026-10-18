import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";
import { Readable as NodeReadable } from "node:stream";

/** Chromium-safe audio codecs for progressive / MSE playback. */
const BROWSER_SAFE_AUDIO = new Set(["aac", "mp3", "opus", "vorbis"]);

/** Probe budget — fail open to AAC encode rather than stall playback. */
const PROBE_TIMEOUT_MS = 3_000;

export function isBrowserSafeAudioCodec(codec: string | null | undefined): boolean {
  if (!codec) return false;
  const c = codec.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (BROWSER_SAFE_AUDIO.has(c)) return true;
  return c === "mp4a" || c.startsWith("aac");
}

/** Codecs safe to bitstream-copy into fragmented MP4 (Chromium progressive). */
export function isStreamCopyableAudioCodec(codec: string | null | undefined): boolean {
  if (!codec) return false;
  const c = codec.toLowerCase().replace(/[^a-z0-9]/g, "");
  return c === "aac" || c === "mp4a" || c.startsWith("aac") || c === "mp3";
}

function isAacCodec(codec: string | null | undefined): boolean {
  if (!codec) return false;
  const c = codec.toLowerCase().replace(/[^a-z0-9]/g, "");
  return c === "aac" || c === "mp4a" || c.startsWith("aac");
}

/** ADTS→ASC needed when copying AAC from MPEG-TS/ADTS into MP4; harmful for some MKV. */
function needsAacAdtsToAsc(formatName: string | null | undefined): boolean {
  if (!formatName) return true;
  const f = formatName.toLowerCase();
  if (f.includes("matroska") || f.includes("webm")) return false;
  return (
    f.includes("mpegts") ||
    f.includes("mpeg") ||
    f.includes("aac") ||
    f.includes("mp4") ||
    f.includes("mov") ||
    f.includes("flv") ||
    f.includes("hls")
  );
}

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

function ffprobeBin(): string {
  const ffmpeg = process.env.FFMPEG_PATH?.trim();
  if (ffmpeg) {
    // Common install layouts: .../ffmpeg ↔ .../ffprobe
    if (ffmpeg.endsWith("ffmpeg")) return `${ffmpeg.slice(0, -"ffmpeg".length)}ffprobe`;
    if (ffmpeg.endsWith("ffmpeg.exe")) return `${ffmpeg.slice(0, -"ffmpeg.exe".length)}ffprobe.exe`;
  }
  return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}

export interface RemuxOptions {
  /** Seek to this timestamp before remux (seconds). */
  startSeconds?: number;
  /** Abort remux (client disconnect / IPTV lease preempt). */
  signal?: AbortSignal;
  /**
   * Force audio handling. When omitted, file/URL remux probes and stream-copies
   * browser-safe audio; pipe remux always encodes AAC (not seekable/probeable).
   */
  copyAudio?: boolean;
}

export interface RemuxHandle {
  stream: PassThrough;
  proc: ChildProcessWithoutNullStreams;
  /** True when audio was stream-copied (no AAC re-encode). */
  copyAudio: boolean;
}

/** Build ffmpeg output args; exported for unit tests. */
export function buildOutputArgs(
  copyAudio: boolean,
  opts?: { audioCodec?: string | null; formatName?: string | null },
): string[] {
  let audioArgs: string[];
  if (copyAudio) {
    audioArgs = ["-c:a", "copy"];
    if (isAacCodec(opts?.audioCodec) && needsAacAdtsToAsc(opts?.formatName)) {
      audioArgs.push("-bsf:a", "aac_adtstoasc");
    }
  } else {
    audioArgs = ["-c:a", "aac", "-ac", "2", "-b:a", "192k"];
  }
  return [
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "copy",
    ...audioArgs,
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1",
  ];
}

function buildPipeArgs(opts?: RemuxOptions): string[] {
  const start = opts?.startSeconds && opts.startSeconds > 0 ? opts.startSeconds : 0;
  const args = ["-hide_banner", "-loglevel", "error", "-i", "pipe:0"];
  // Output seek for pipes (cannot input-seek a non-seekable stream).
  if (start > 0) args.push("-ss", String(start));
  // Pipe path cannot probe without consuming the body — always AAC.
  args.push(...buildOutputArgs(false));
  return args;
}

function buildFileArgs(
  filePath: string,
  copyAudio: boolean,
  opts?: RemuxOptions,
  probe?: { audioCodec?: string | null; formatName?: string | null },
): string[] {
  const start = opts?.startSeconds && opts.startSeconds > 0 ? opts.startSeconds : 0;
  const args = ["-hide_banner", "-loglevel", "error"];
  if (start > 0) args.push("-ss", String(start));
  args.push("-i", filePath, ...buildOutputArgs(copyAudio, probe));
  return args;
}

function buildUrlArgs(
  url: string,
  headers: Record<string, string>,
  copyAudio: boolean,
  opts?: RemuxOptions,
  probe?: { audioCodec?: string | null; formatName?: string | null },
): string[] {
  const start = opts?.startSeconds && opts.startSeconds > 0 ? opts.startSeconds : 0;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    // Block non-HTTP protocols from hostile playlists (file, concat, etc.).
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto",
  ];
  // Input seek — ffmpeg can Range/seek when the source is a URL/file.
  if (start > 0) args.push("-ss", String(start));
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
  if (headerLines) {
    args.push("-headers", `${headerLines}\r\n`);
  }
  args.push("-i", url, ...buildOutputArgs(copyAudio, probe));
  return args;
}

export interface AudioProbeResult {
  codec: string | null;
  formatName: string | null;
}

/**
 * Probe the first audio stream codec (+ container) via ffprobe.
 * Returns nulls on timeout, missing binary, or no audio — callers encode AAC.
 */
export function probeAudioStream(opts: {
  filePath?: string;
  url?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<AudioProbeResult> {
  const { filePath, url, headers = {}, signal } = opts;
  if (!filePath && !url) return Promise.resolve({ codec: null, formatName: null });

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ codec: null, formatName: null });
      return;
    }

    const args = [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name:format=format_name",
      "-of",
      "json",
    ];
    if (url) {
      args.push("-protocol_whitelist", "file,http,https,tcp,tls,crypto");
      const headerLines = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n");
      if (headerLines) args.push("-headers", `${headerLines}\r\n`);
      args.push("-i", url);
    } else if (filePath) {
      args.push("-i", filePath);
    }

    let settled = false;
    const finish = (value: AudioProbeResult) => {
      if (settled) return;
      settled = true;
      cleanupAbort?.();
      clearTimeout(timer);
      resolve(value);
    };

    const proc = spawn(ffprobeBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";

    const timer = setTimeout(() => {
      try {
        if (!proc.killed) proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      finish({ codec: null, formatName: null });
    }, PROBE_TIMEOUT_MS);

    let cleanupAbort: (() => void) | undefined;
    if (signal) {
      const onAbort = () => {
        try {
          if (!proc.killed) proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        finish({ codec: null, formatName: null });
      };
      signal.addEventListener("abort", onAbort, { once: true });
      cleanupAbort = () => signal.removeEventListener("abort", onAbort);
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.on("error", () => finish({ codec: null, formatName: null }));
    proc.on("close", (code) => {
      if (code !== 0) {
        finish({ codec: null, formatName: null });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          streams?: Array<{ codec_name?: string }>;
          format?: { format_name?: string };
        };
        const codec = parsed.streams?.[0]?.codec_name?.trim() || null;
        const formatName = parsed.format?.format_name?.trim() || null;
        finish({ codec, formatName });
      } catch {
        finish({ codec: null, formatName: null });
      }
    });
  });
}

/** @deprecated Prefer probeAudioStream — kept for call sites that only need the codec. */
export async function probeFirstAudioCodec(opts: {
  filePath?: string;
  url?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { codec } = await probeAudioStream(opts);
  return codec;
}

async function resolveAudioPlan(opts: {
  filePath?: string;
  url?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  forcedCopy?: boolean;
}): Promise<{ copyAudio: boolean; audioCodec: string | null; formatName: string | null }> {
  if (opts.forcedCopy === false) {
    return { copyAudio: false, audioCodec: null, formatName: null };
  }
  const probe = await probeAudioStream({
    filePath: opts.filePath,
    url: opts.url,
    headers: opts.headers,
    signal: opts.signal,
  });
  const copyAudio =
    opts.forcedCopy === true || isStreamCopyableAudioCodec(probe.codec);
  return { copyAudio, audioCodec: probe.codec, formatName: probe.formatName };
}

function attachProcess(
  ff: ChildProcessWithoutNullStreams,
  input?: Readable,
  signal?: AbortSignal,
): { stream: PassThrough; proc: ChildProcessWithoutNullStreams } {
  const out = new PassThrough();
  let stderr = "";

  const kill = (err?: Error) => {
    try {
      if (!ff.killed) ff.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    if (!out.destroyed) {
      if (err) out.destroy(err);
      else out.destroy();
    }
  };

  if (signal) {
    if (signal.aborted) kill();
    else signal.addEventListener("abort", () => kill(), { once: true });
  }

  // Missing binary / spawn failure must not crash the Node process.
  ff.on("error", (err) => {
    kill(err instanceof Error ? err : new Error(String(err)));
  });

  ff.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  if (input) {
    input.pipe(ff.stdin);
    input.on("error", (err) => {
      try {
        ff.stdin.destroy();
      } catch {
        /* ignore */
      }
      kill(err instanceof Error ? err : new Error(String(err)));
    });
    ff.stdin.on("error", () => {
      /* upstream closed */
    });
  } else {
    ff.stdin.end();
  }

  ff.stdout.pipe(out);

  ff.on("close", (code) => {
    if (code && code !== 0 && !out.destroyed) {
      out.destroy(
        new Error(`ffmpeg remux failed (exit ${code}): ${stderr.trim() || "unknown error"}`),
      );
    } else if (!out.destroyed) {
      out.end();
    }
  });

  return { stream: out, proc: ff };
}

/**
 * Remux/transcode a Node readable to fragmented MP4 with AAC audio.
 * Pipe inputs cannot be probed — always re-encodes audio to AAC.
 */
export function remuxToBrowserMp4(
  input: Readable,
  opts?: RemuxOptions,
): RemuxHandle {
  const ff = spawn(ffmpegBin(), buildPipeArgs(opts), {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const { stream, proc } = attachProcess(ff, input, opts?.signal);
  return { stream, proc, copyAudio: false };
}

/**
 * Remux a local file (supports fast `-ss` input seek for scrubbing).
 * Stream-copies AAC/mp3 when ffprobe reports them; otherwise re-encodes to AAC.
 */
export async function remuxToBrowserMp4FromFile(
  filePath: string,
  opts?: RemuxOptions,
): Promise<RemuxHandle> {
  const plan = await resolveAudioPlan({
    filePath,
    signal: opts?.signal,
    forcedCopy: opts?.copyAudio,
  });
  const ff = spawn(
    ffmpegBin(),
    buildFileArgs(filePath, plan.copyAudio, opts, {
      audioCodec: plan.audioCodec,
      formatName: plan.formatName,
    }),
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const { stream, proc } = attachProcess(ff, undefined, opts?.signal);
  return { stream, proc, copyAudio: plan.copyAudio };
}

/**
 * Remux from an HTTP(S) URL with optional auth headers.
 * Uses `-ss` before `-i` so seeks do not read the whole file from t=0.
 * Probes first (sequentially) so IPTV connection budget is not doubled.
 */
export async function remuxToBrowserMp4FromUrl(
  url: string,
  headers: Record<string, string>,
  opts?: RemuxOptions,
): Promise<RemuxHandle> {
  const plan = await resolveAudioPlan({
    url,
    headers,
    signal: opts?.signal,
    forcedCopy: opts?.copyAudio,
  });
  const ff = spawn(
    ffmpegBin(),
    buildUrlArgs(url, headers, plan.copyAudio, opts, {
      audioCodec: plan.audioCodec,
      formatName: plan.formatName,
    }),
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const { stream, proc } = attachProcess(ff, undefined, opts?.signal);
  return { stream, proc, copyAudio: plan.copyAudio };
}

/** Convert a Web ReadableStream (fetch body) into a Node Readable. */
export function webStreamToNode(stream: ReadableStream<Uint8Array>): Readable {
  return NodeReadable.fromWeb(stream as import("node:stream/web").ReadableStream);
}

/** Header value for X-Streamerr-Remux. */
export function remuxModeHeader(copyAudio: boolean): string {
  return copyAudio ? "copy-mp4" : "aac-mp4";
}
