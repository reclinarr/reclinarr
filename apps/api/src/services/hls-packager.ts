import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  hlsDir,
  hlsFinalized,
  hlsPlaybackReady,
  hlsPlaylistPath,
} from "./hls-paths.js";
import { isBrowserSafeAudioCodec } from "./ffmpeg-remux.js";

const MIN_BYTES_BEFORE_PACK = 1_500_000;
const POLL_MS = 2_000;
const PACK_STALL_MS = 4_000;

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

function ffprobeBin(): string {
  const ffmpeg = process.env.FFMPEG_PATH?.trim();
  if (ffmpeg) {
    if (ffmpeg.endsWith("ffmpeg")) return `${ffmpeg.slice(0, -"ffmpeg".length)}ffprobe`;
    if (ffmpeg.endsWith("ffmpeg.exe")) {
      return `${ffmpeg.slice(0, -"ffmpeg.exe".length)}ffprobe.exe`;
    }
  }
  return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}

export interface PackagerJob {
  id: string;
  localPath: string;
  /** True when the acquisition download has finished. */
  downloadComplete: boolean;
  bytesDownloaded: number;
}

export interface PackagerJobSource {
  listActive(): PackagerJob[];
  /** Mark acquisition playable once the first HLS segment exists. */
  markHlsReady?(id: string): void;
}

/**
 * Packages growing IPTV cache files into an HLS event playlist on disk.
 * One ffmpeg pass per growth burst; resumes from the last segment end time.
 */
export class HlsPackager {
  private readonly busy = new Set<string>();
  private readonly lastPackSize = new Map<string, number>();
  private readonly lastEndSeconds = new Map<string, number>();
  private readonly copyAudio = new Map<string, boolean>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(
    private readonly dataDir: string,
    private readonly source: PackagerJobSource,
  ) {}

  start(opts?: { keepProcessAlive?: boolean }): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        console.error("[packager] tick failed", err);
      });
    }, POLL_MS);
    // Embedded in the API: don't pin the event loop. Standalone process: keep alive.
    if (!opts?.keepProcessAlive) {
      this.timer.unref?.();
    }
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    for (const job of this.source.listActive()) {
      if (this.busy.has(job.id)) continue;
      if (!job.localPath || !existsSync(job.localPath)) continue;
      if (hlsFinalized(this.dataDir, job.id)) continue;

      const size = (() => {
        try {
          return statSync(job.localPath).size;
        } catch {
          return 0;
        }
      })();
      if (size < MIN_BYTES_BEFORE_PACK && !job.downloadComplete) continue;

      const lastSize = this.lastPackSize.get(job.id) ?? 0;
      const grew = size > lastSize + 64_000;
      const ready = hlsPlaybackReady(this.dataDir, job.id);

      // Re-pack when the file grew, or drain/finalize when the download completed.
      if (!grew && !job.downloadComplete && ready) continue;
      if (!grew && !job.downloadComplete && !ready) {
        // First pack: brief stall so container headers settle on disk.
        await sleep(PACK_STALL_MS);
      }

      this.busy.add(job.id);
      try {
        await this.packOnce(job);
        this.lastPackSize.set(job.id, size);
        if (hlsPlaybackReady(this.dataDir, job.id)) {
          this.source.markHlsReady?.(job.id);
        }
      } catch (err) {
        console.error(`[packager] ${job.id} failed`, err);
      } finally {
        this.busy.delete(job.id);
      }
    }
  }

  private async packOnce(job: PackagerJob): Promise<void> {
    const outDir = hlsDir(this.dataDir, job.id);
    mkdirSync(outDir, { recursive: true });

    const copyAudio = await this.resolveCopyAudio(job.id, job.localPath);
    const startSeconds = this.lastEndSeconds.get(job.id) ?? 0;
    const playlist = hlsPlaylistPath(this.dataDir, job.id);
    const isFirst = !existsSync(playlist) || startSeconds <= 0;

    // Package a short window so we stop before the growing EOF.
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-probesize",
      "1M",
      "-analyzeduration",
      "2M",
    ];
    if (startSeconds > 0) {
      args.push("-ss", String(startSeconds));
    }
    args.push("-i", job.localPath);
    if (!job.downloadComplete) {
      args.push("-t", "30");
    }
    const beforeSegs = countSegments(playlist);
    args.push(
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "copy",
      ...(copyAudio
        ? (["-c:a", "copy"] as const)
        : (["-c:a", "aac", "-ac", "2", "-b:a", "192k"] as const)),
      "-f",
      "hls",
      "-hls_time",
      "4",
      "-hls_list_size",
      "0",
      "-start_number",
      String(beforeSegs),
      "-hls_flags",
      isFirst
        ? "independent_segments+omit_endlist"
        : "independent_segments+append_list+omit_endlist",
      "-hls_segment_filename",
      join(outDir, "seg_%05d.ts"),
      playlist,
    );

    const code = await runFfmpeg(args);
    if (code !== 0 && !hlsPlaybackReady(this.dataDir, job.id)) {
      throw new Error(`ffmpeg hls exit ${code}`);
    }

    const afterSegs = countSegments(playlist);
    if (afterSegs > beforeSegs) {
      // Advance resume point by roughly packed duration (4s target × new segs).
      this.lastEndSeconds.set(job.id, startSeconds + (afterSegs - beforeSegs) * 4);
    }

    if (job.downloadComplete && !hlsFinalized(this.dataDir, job.id)) {
      await this.finalizeRemainder(job, copyAudio);
    }
  }

  private async finalizeRemainder(job: PackagerJob, copyAudio: boolean): Promise<void> {
    const outDir = hlsDir(this.dataDir, job.id);
    const playlist = hlsPlaylistPath(this.dataDir, job.id);
    const startSeconds = this.lastEndSeconds.get(job.id) ?? 0;
    const startNumber = countSegments(playlist);
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(startSeconds),
      "-i",
      job.localPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "copy",
      ...(copyAudio
        ? (["-c:a", "copy"] as const)
        : (["-c:a", "aac", "-ac", "2", "-b:a", "192k"] as const)),
      "-f",
      "hls",
      "-hls_time",
      "4",
      "-hls_list_size",
      "0",
      "-start_number",
      String(startNumber),
      "-hls_flags",
      "independent_segments+append_list",
      "-hls_segment_filename",
      join(outDir, "seg_%05d.ts"),
      playlist,
    ];
    await runFfmpeg(args);
    finalizePlaylist(playlist);
  }

  private async resolveCopyAudio(id: string, filePath: string): Promise<boolean> {
    const cached = this.copyAudio.get(id);
    if (cached != null) return cached;
    const codec = await probeAudioCodec(filePath);
    const copy = isBrowserSafeAudioCodec(codec);
    this.copyAudio.set(id, copy);
    return copy;
  }
}

function countSegments(playlist: string): number {
  if (!existsSync(playlist)) return 0;
  try {
    return (readFileSync(playlist, "utf8").match(/#EXTINF:/g) ?? []).length;
  } catch {
    return 0;
  }
}

function finalizePlaylist(playlist: string): void {
  if (!existsSync(playlist)) return;
  try {
    let text = readFileSync(playlist, "utf8");
    if (!text.includes("#EXT-X-ENDLIST")) {
      if (!text.endsWith("\n")) text += "\n";
      text += "#EXT-X-ENDLIST\n";
      writeFileSync(playlist, text);
    }
  } catch {
    /* ignore */
  }
}

function runFfmpeg(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
      if (stderr.length > 2000) stderr = stderr.slice(-2000);
    });
    proc.on("error", () => resolve(1));
    proc.on("close", (code) => {
      if (code && code !== 0 && stderr.trim()) {
        console.warn("[packager] ffmpeg:", stderr.trim().slice(0, 400));
      }
      resolve(code ?? 1);
    });
  });
}

function probeAudioCodec(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const args = [
      "-v",
      "error",
      "-probesize",
      "1M",
      "-analyzeduration",
      "2M",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "csv=p=0",
      "-i",
      filePath,
    ];
    const proc = spawn(ffprobeBin(), args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve(null);
    }, 3_000);
    proc.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    proc.on("close", () => {
      clearTimeout(timer);
      const codec = stdout.trim().split(/\r?\n/)[0]?.trim() || null;
      resolve(codec && codec !== "N/A" ? codec : null);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Standalone / embedded entry: poll acquisitions via a callback source. */
export function startHlsPackager(
  dataDir: string,
  source: PackagerJobSource,
  opts?: { keepProcessAlive?: boolean },
): HlsPackager {
  const packager = new HlsPackager(dataDir, source);
  packager.start(opts);
  return packager;
}
