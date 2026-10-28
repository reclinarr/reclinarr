import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Readable as NodeReadable } from "node:stream";
import { formatIptvUpstreamError } from "@reclinarr/shared";
import {
  libx264Encoder,
  selectLiveVideoEncoder,
  type LiveVideoEncoder,
} from "./ffmpeg-video-encoder.js";
import type { IptvConnectionManager, IptvLease } from "./iptv-connection-manager.js";

const READY_TIMEOUT_MS = 35_000;
const IDLE_MS = 120_000;
const REAP_MS = 15_000;
/** Players heartbeat every 30s; a viewer silent this long is gone (crashed app, lost network). */
export const LIVE_VIEWER_TTL_MS = 120_000;
const HLS_TIME = 2;
/** Sliding window — keep enough that AVPlayer can buffer before delete_segments. */
const HLS_LIST_SIZE = 12;
/** Don't hand the playlist to clients until we have a real window. */
const READY_MIN_SEGMENTS = 3;
/** Cap backoff when ffmpeg / upstream dies while someone is still watching. */
const RESTART_MAX_DELAY_MS = 15_000;

/** Delay before restarting a dead live remux (exported for unit tests). */
export function liveHlsRestartDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(RESTART_MAX_DELAY_MS, 750 * 2 ** Math.min(n - 1, 4));
}

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

export function liveHlsDir(dataDir: string, uuid: string): string {
  return join(dataDir, "live-hls", uuid);
}

export function liveHlsPlaylistPath(dataDir: string, uuid: string): string {
  return join(liveHlsDir(dataDir, uuid), "index.m3u8");
}

export function liveHlsSegmentCount(dataDir: string, uuid: string): number {
  const playlist = liveHlsPlaylistPath(dataDir, uuid);
  if (!existsSync(playlist)) return 0;
  try {
    return (readFileSync(playlist, "utf8").match(/#EXTINF:/g) ?? []).length;
  } catch {
    return 0;
  }
}

export function liveHlsReady(dataDir: string, uuid: string): boolean {
  return liveHlsSegmentCount(dataDir, uuid) >= READY_MIN_SEGMENTS;
}

/** ffmpeg argv for live MPEG-TS → HLS (exported for unit tests). */
export function buildLiveHlsFfmpegArgs(
  dir: string,
  playlist: string,
  encoder: LiveVideoEncoder = libx264Encoder(HLS_TIME),
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-fflags",
    "+genpts+igndts+discardcorrupt",
    "-flags",
    "low_delay",
    "-probesize",
    "2M",
    "-analyzeduration",
    "3M",
    ...encoder.beforeInput,
    "-i",
    "pipe:0",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    ...encoder.videoArgs,
    // Stretch/squeeze/pad audio so PTS stays locked to video under IPTV jitter.
    "-af",
    "aresample=async=1:first_pts=0",
    "-c:a",
    "aac",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-b:a",
    "128k",
    "-max_interleave_delta",
    "0",
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
    "-f",
    "hls",
    "-hls_time",
    String(HLS_TIME),
    "-hls_list_size",
    String(HLS_LIST_SIZE),
    "-hls_flags",
    "delete_segments+independent_segments+omit_endlist",
    "-hls_segment_type",
    "mpegts",
    "-hls_segment_filename",
    join(dir, "seg_%05d.ts"),
    playlist,
  ];
}

type OpenLiveStream = (opts: {
  uuid: string;
  signal?: AbortSignal;
}) => Promise<Response>;

interface Session {
  uuid: string;
  dir: string;
  lease: IptvLease;
  proc: ChildProcess;
  lastAccess: number;
  startedAt: number;
  stderr: string;
}

/**
 * Remux Dispatcharr live MPEG-TS → sliding-window HLS for AVPlayer (iOS).
 * One ffmpeg session per channel; idle sessions are reaped.
 */
export class LiveHlsManager {
  private readonly sessions = new Map<string, Session>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private readonly viewers = new Map<string, string>();
  private readonly viewerSeenAt = new Map<string, number>();
  private readonly pending = new Map<string, Promise<void>>();
  /** Last opener per channel — used to restart after an unexpected ffmpeg exit. */
  private readonly openers = new Map<string, OpenLiveStream>();
  private readonly restartTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly restartAttempts = new Map<string, number>();

  constructor(
    private readonly dataDir: string,
    private readonly iptv: IptvConnectionManager,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.reapIdle(), REAP_MS);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const uuid of [...this.restartTimers.keys()]) this.clearRestart(uuid);
    this.stopAll();
  }

  /** Drop every remux session so VOD/acquisition can take the IPTV slot. */
  stopAll(): void {
    for (const uuid of [...this.sessions.keys()]) this.stopChannel(uuid);
  }

  stopChannel(uuid: string): void {
    this.clearRestart(uuid);
    this.openers.delete(uuid);
    this.restartAttempts.delete(uuid);
    this.stopSession(uuid);
  }

  registerViewer(owner: string, uuid: string): void {
    this.viewers.set(owner, uuid);
    this.viewerSeenAt.set(owner, Date.now());
  }

  /** Keeps a viewer alive. False when the owner is not tuned to this channel (re-tune needed). */
  heartbeat(owner: string, uuid: string): boolean {
    if (this.viewers.get(owner) !== uuid) return false;
    this.viewerSeenAt.set(owner, Date.now());
    return true;
  }

  hasViewer(owner: string, uuid: string): boolean {
    return this.viewers.get(owner) === uuid;
  }

  /** True when any client still has this channel selected. */
  channelHasViewers(uuid: string): boolean {
    for (const current of this.viewers.values()) {
      if (current === uuid) return true;
    }
    return false;
  }

  releaseViewer(owner: string, uuid?: string): string | undefined {
    const current = this.viewers.get(owner);
    if (!current || (uuid && uuid !== current)) return undefined;
    this.viewers.delete(owner);
    this.viewerSeenAt.delete(owner);
    return this.channelHasViewers(current) ? undefined : current;
  }

  touch(uuid: string): void {
    const s = this.sessions.get(uuid);
    if (s) s.lastAccess = Date.now();
  }

  filePath(uuid: string, relative: string): string | null {
    const clean = relative
      .replace(/\.\./g, "")
      .replace(/^\/+/, "")
      .replace(/\/+/g, "/");
    if (!clean || clean.includes("/")) return null;
    const path = join(liveHlsDir(this.dataDir, uuid), clean);
    if (!path.startsWith(liveHlsDir(this.dataDir, uuid))) return null;
    return path;
  }

  /**
   * Ensure a remux session is running and the playlist has at least one segment.
   */
  async ensureReady(uuid: string, openLiveStream: OpenLiveStream): Promise<void> {
    if (this.stopped) throw new Error("Live HLS manager stopped");
    this.start();
    this.openers.set(uuid, openLiveStream);
    this.clearRestart(uuid);
    this.touch(uuid);
    const existing = this.pending.get(uuid);
    if (existing) return existing;
    const ready = (async () => {
      if (!this.sessions.has(uuid)) await this.startSession(uuid, openLiveStream);
      if (!liveHlsReady(this.dataDir, uuid)) await this.waitReady(uuid);
      this.touch(uuid);
      this.restartAttempts.delete(uuid);
    })();
    this.pending.set(uuid, ready);
    try {
      await ready;
    } catch (error) {
      this.stopSession(uuid);
      throw error;
    } finally {
      this.pending.delete(uuid);
    }
  }

  private async startSession(uuid: string, openLiveStream: OpenLiveStream): Promise<void> {
    // Retune: kill previous remux for this (or any) channel if we're replacing.
    this.stopSession(uuid);
    this.openers.set(uuid, openLiveStream);

    const dir = liveHlsDir(this.dataDir, uuid);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const lease = this.iptv.acquire("live", { label: `live-hls:${uuid}` });
    let upstream: Response;
    try {
      upstream = await openLiveStream({ uuid, signal: lease.signal });
    } catch (err) {
      lease.release();
      throw err;
    }
    if (lease.signal.aborted || this.stopped) {
      lease.release();
      await upstream.body?.cancel();
      throw new Error("Live playback was cancelled");
    }
    if (!upstream.ok || !upstream.body) {
      lease.release();
      const errText = await upstream.text().catch(() => "");
      throw Object.assign(
        new Error(
          formatIptvUpstreamError(upstream.status, errText) ??
            (errText || `Dispatcharr live stream failed (${upstream.status})`),
        ),
        { statusCode: upstream.status },
      );
    }

    const playlist = join(dir, "index.m3u8");
    // Re-encode with IDR-aligned segments. Stream-copy looks fine in ffprobe for
    // some channels but AVPlayer still fails with "The resource is unavailable"
    // on live IPTV TS. aresample=async keeps A/V locked when upstream PCR/PTS
    // jitter would otherwise drift audio vs video across segment boundaries.
    // GPU encode is used when a probe frame succeeds; otherwise libx264.
    const encoder = await selectLiveVideoEncoder({ hlsTime: HLS_TIME, bin: ffmpegBin() });
    const args = buildLiveHlsFfmpegArgs(dir, playlist, encoder);

    const proc = spawn(ffmpegBin(), args, { stdio: ["pipe", "ignore", "pipe"] });
    const session: Session = {
      uuid,
      dir,
      lease,
      proc,
      lastAccess: Date.now(),
      startedAt: Date.now(),
      stderr: "",
    };
    this.sessions.set(uuid, session);

    proc.stderr?.on("data", (chunk: Buffer) => {
      session.stderr += chunk.toString("utf8");
      if (session.stderr.length > 4000) session.stderr = session.stderr.slice(-4000);
    });

    proc.on("error", (err) => {
      console.error(`[live-hls] ${uuid} ffmpeg spawn failed`, err);
      if (this.sessions.get(uuid)?.proc === proc) {
        this.stopSession(uuid);
        this.scheduleRestart(uuid);
      }
    });

    proc.on("close", (code) => {
      if (this.sessions.get(uuid)?.proc === proc) {
        if (code && code !== 0) {
          console.error(
            `[live-hls] ${uuid} ffmpeg exit ${code}: ${session.stderr.trim() || "unknown"}`,
          );
        } else {
          console.info(`[live-hls] ${uuid} ffmpeg exited`);
        }
        this.stopSession(uuid);
        this.scheduleRestart(uuid);
      }
    });

    const nodeIn = NodeReadable.fromWeb(
      upstream.body as import("node:stream/web").ReadableStream,
    );
    const stdin = proc.stdin;
    if (!stdin) {
      lease.release();
      this.sessions.delete(uuid);
      throw new Error("ffmpeg stdin unavailable");
    }
    nodeIn.pipe(stdin);
    nodeIn.on("error", () => {
      try {
        stdin.destroy();
      } catch {
        /* ignore */
      }
    });
    stdin.on("error", () => {
      /* upstream closed */
    });

    lease.signal.addEventListener(
      "abort",
      () => {
        if (this.sessions.get(uuid)?.proc === proc) {
          this.stopSession(uuid);
          // Preempted IPTV slot or cancelled upstream — rejoin if someone is still tuned.
          this.scheduleRestart(uuid);
        }
      },
      { once: true },
    );

    // Marker so empty dirs aren't mistaken for ready.
    writeFileSync(join(dir, ".started"), String(Date.now()));
  }

  private async waitReady(uuid: string): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (liveHlsReady(this.dataDir, uuid)) return;
      const session = this.sessions.get(uuid);
      if (!session) {
        throw new Error("Live HLS remux stopped before ready");
      }
      if (session.proc.killed || session.proc.exitCode != null) {
        throw new Error(
          `Live HLS remux failed: ${session.stderr.trim() || "ffmpeg exited"}`,
        );
      }
      await sleep(400);
    }
    throw Object.assign(new Error("Live HLS remux timed out waiting for segments"), {
      statusCode: 504,
    });
  }

  private stopSession(uuid: string): void {
    const session = this.sessions.get(uuid);
    if (!session) {
      rmSync(liveHlsDir(this.dataDir, uuid), { recursive: true, force: true });
      return;
    }
    this.sessions.delete(uuid);
    try {
      if (!session.proc.killed) session.proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      session.lease.release();
    } catch {
      /* ignore */
    }
    rmSync(session.dir, { recursive: true, force: true });
  }

  private clearRestart(uuid: string): void {
    const timer = this.restartTimers.get(uuid);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(uuid);
    }
  }

  /**
   * When ffmpeg / upstream dies mid-watch, bring the remux back so playlist polls
   * and the player can rejoin without the user leaving the player.
   */
  private scheduleRestart(uuid: string): void {
    if (this.stopped || !this.channelHasViewers(uuid)) return;
    if (this.sessions.has(uuid) || this.pending.has(uuid) || this.restartTimers.has(uuid)) return;
    const opener = this.openers.get(uuid);
    if (!opener) return;

    const attempt = (this.restartAttempts.get(uuid) ?? 0) + 1;
    this.restartAttempts.set(uuid, attempt);
    const delay = liveHlsRestartDelayMs(attempt);
    console.info(`[live-hls] ${uuid} restarting in ${delay}ms (attempt ${attempt})`);
    const timer = setTimeout(() => {
      this.restartTimers.delete(uuid);
      if (this.stopped || !this.channelHasViewers(uuid)) return;
      if (this.sessions.has(uuid) || this.pending.has(uuid)) return;
      const open = this.openers.get(uuid);
      if (!open) return;
      void this.ensureReady(uuid, open).catch((err) => {
        console.error(
          `[live-hls] ${uuid} restart failed:`,
          err instanceof Error ? err.message : err,
        );
        this.scheduleRestart(uuid);
      });
    }, delay);
    timer.unref?.();
    this.restartTimers.set(uuid, timer);
  }

  private reapIdle(): void {
    const now = Date.now();
    for (const [uuid, session] of this.sessions) {
      if (now - session.lastAccess > IDLE_MS) {
        console.info(`[live-hls] reaping idle session ${uuid}`);
        // Drop abandoned viewer rows (crashed tab / missed stop) so we do not
        // keep auto-restarting a channel nobody is polling anymore.
        for (const [owner, channel] of [...this.viewers.entries()]) {
          if (channel === uuid) {
            this.viewers.delete(owner);
            this.viewerSeenAt.delete(owner);
          }
        }
        this.stopChannel(uuid);
      }
    }
    this.reapSilentViewers(now);
  }

  /**
   * nginx-proxied MPEG-TS gives the API no disconnect signal, so the IPTV hold for a channel
   * is released once every viewer of it has stopped heartbeating.
   */
  reapSilentViewers(now = Date.now()): void {
    for (const [owner, uuid] of [...this.viewers.entries()]) {
      if (now - (this.viewerSeenAt.get(owner) ?? 0) <= LIVE_VIEWER_TTL_MS) continue;
      const unused = this.releaseViewer(owner, uuid);
      if (!unused) continue;
      console.info(`[live-hls] releasing ${unused}: no viewer heartbeat`);
      this.stopChannel(unused);
      this.iptv.releaseLiveChannel(unused);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
