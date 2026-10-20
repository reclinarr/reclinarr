import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
/** Rebuild at most this often while the file is still growing. */
const MIN_REPACK_GROWTH_BYTES = 32 * 1024 * 1024;

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
  /** True when the acquisition download has finished (or failed with a partial file). */
  downloadComplete: boolean;
  bytesDownloaded: number;
}

export interface PackagerJobSource {
  listActive(): PackagerJob[];
  /** Mark acquisition playable once the first HLS segment exists. */
  markHlsReady?(id: string): void;
}

/**
 * Packages IPTV cache files into a contiguous HLS playlist on disk.
 *
 * Always rebuilds from the start of the file (stream copy). The previous
 * append_list + -ss approach inserted hundreds of discontinuities and a high
 * MEDIA-SEQUENCE, so AVPlayer treated the playlist as a live edge near ~25% of
 * a full movie and then stalled with "Playback stopped unexpectedly".
 */
export class HlsPackager {
  private readonly busy = new Set<string>();
  private readonly lastPackSize = new Map<string, number>();
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
      const grew = size > lastSize + MIN_REPACK_GROWTH_BYTES;
      const ready = hlsPlaybackReady(this.dataDir, job.id);
      const broken = ready && playlistNeedsRebuild(hlsPlaylistPath(this.dataDir, job.id));

      // Re-pack when the file grew enough, playlist is broken, or download finished.
      if (!grew && !job.downloadComplete && ready && !broken) continue;
      if (!grew && !job.downloadComplete && !ready) {
        // First pack: brief stall so container headers settle on disk.
        await sleep(PACK_STALL_MS);
      }

      this.busy.add(job.id);
      try {
        await this.packFromStart(job);
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

  private async packFromStart(job: PackagerJob): Promise<void> {
    const outDir = hlsDir(this.dataDir, job.id);
    mkdirSync(outDir, { recursive: true });
    clearHlsOutput(outDir);

    const copyAudio = await this.resolveCopyAudio(job.id, job.localPath);
    const playlist = hlsPlaylistPath(this.dataDir, job.id);

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-err_detect",
      "ignore_err",
      "-probesize",
      "1M",
      "-analyzeduration",
      "2M",
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
      "-hls_playlist_type",
      job.downloadComplete ? "vod" : "event",
      "-start_number",
      "0",
      "-hls_flags",
      job.downloadComplete
        ? "independent_segments"
        : "independent_segments+omit_endlist",
      "-hls_segment_filename",
      join(outDir, "seg_%05d.ts"),
      playlist,
    ];

    const code = await runFfmpeg(args);
    if (code !== 0 && !hlsPlaybackReady(this.dataDir, job.id)) {
      throw new Error(`ffmpeg hls exit ${code}`);
    }

    if (job.downloadComplete) {
      ensureEndList(playlist);
    }
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

/** True when an on-disk playlist would confuse AVPlayer (live-edge / gaps). */
export function playlistNeedsRebuild(playlistPath: string): boolean {
  if (!existsSync(playlistPath)) return false;
  try {
    const text = readFileSync(playlistPath, "utf8");
    if (text.includes("#EXT-X-DISCONTINUITY")) return true;
    const seq = text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    if (seq && Number(seq[1]) > 0) return true;
    return false;
  } catch {
    return false;
  }
}

function clearHlsOutput(outDir: string): void {
  if (!existsSync(outDir)) return;
  for (const name of readdirSync(outDir)) {
    if (
      name === "index.m3u8" ||
      name.endsWith(".ts") ||
      name.endsWith(".m4s") ||
      name.endsWith(".mp4")
    ) {
      try {
        rmSync(join(outDir, name), { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

function ensureEndList(playlist: string): void {
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
