import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, renameSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type {
  Acquisition,
  AcquisitionMode,
  AcquisitionSource,
  MediaIdentity,
} from "@reclinarr/shared";
import { DispatcharrProvider, type MockDispatcharrProvider } from "@reclinarr/providers";
import type { AppDb } from "../db/client.js";
import { acquisitions as acquisitionsTable } from "../db/schema.js";
import { HttpDownloadTransport } from "./download-transport.js";
import type { CacheManager } from "./cache-manager.js";
import type { IptvConnectionManager } from "./iptv-connection-manager.js";
import {
  buildLibraryRelativePath,
  type LibraryNamingMeta,
} from "./library-path.js";

import { hlsPlaybackReady, removeHlsDir } from "./hls-paths.js";
import type { PackagerJob } from "./hls-packager.js";

export class AcquisitionManager {
  private readonly controllers = new Map<string, AbortController>();
  /** Identities currently entering start() — prevents duplicate IPTV pulls. */
  private readonly startingKeys = new Set<string>();
  private readonly transport = new HttpDownloadTransport();
  private onLibraryPromoted?: (localPath: string) => void | Promise<void>;
  private libraryMetaResolver?: (
    identity: MediaIdentity,
  ) => Promise<LibraryNamingMeta | undefined>;
  private readonly iptvConnections?: IptvConnectionManager;
  private readonly cacheManager?: CacheManager;
  private readonly cacheTtlMs: number;

  constructor(
    private readonly dataDir: string,
    private readonly dispatcharr: DispatcharrProvider | MockDispatcharrProvider,
    private readonly db: AppDb,
    deps?: {
      iptvConnections?: IptvConnectionManager;
      cacheManager?: CacheManager;
      cacheTtlMs?: number;
    },
  ) {
    this.iptvConnections = deps?.iptvConnections;
    this.cacheManager = deps?.cacheManager;
    this.cacheTtlMs = deps?.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  /**
   * API process boot only: mark in-flight rows failed-but-resumable so CacheManager
   * can evict orphans after a crash.
   *
   * Must NOT run in the Docker HLS packager sidecar — that process shares the same
   * SQLite DB and would fail live downloads the API is still writing, which drops
   * them from listPackagerJobs() and blocks play-while-download.
   */
  failInterruptedOnBoot(): number {
    let failed = 0;
    for (const row of this.db.select().from(acquisitionsTable).all()) {
      if (row.state === "downloading" || row.state === "queued" || row.state === "playable") {
        this.db
          .update(acquisitionsTable)
          .set({ state: "failed", updatedAt: new Date().toISOString() })
          .where(eq(acquisitionsTable.id, row.id))
          .run();
        failed += 1;
      }
    }
    return failed;
  }

  /** Called after a file lands in the library folder (promote or library-mode download). */
  setLibraryPromotedHandler(handler: (localPath: string) => void | Promise<void>): void {
    this.onLibraryPromoted = handler;
  }

  /** Optional Seerr/TMDb title lookup for Jellyfin-friendly folder names. */
  setLibraryMetaResolver(
    resolver: (identity: MediaIdentity) => Promise<LibraryNamingMeta | undefined>,
  ): void {
    this.libraryMetaResolver = resolver;
  }

  private async libraryDest(identity: MediaIdentity, meta?: LibraryNamingMeta | null): Promise<string> {
    const resolved = meta ?? (await this.libraryMetaResolver?.(identity).catch(() => undefined));
    return join(this.dataDir, buildLibraryRelativePath(identity, resolved));
  }

  list(): Acquisition[] {
    return this.db
      .select()
      .from(acquisitionsTable)
      .all()
      .map((r) => this.rowToAcquisition(r))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Acquisition | undefined {
    const row = this.db
      .select()
      .from(acquisitionsTable)
      .where(eq(acquisitionsTable.id, id))
      .all()[0];
    if (!row) return undefined;
    const job = this.rowToAcquisition(row);
    // Reflect HLS readiness without writing (avoids re-entrant get→markHlsReady).
    if (!job.playbackAvailable && hlsPlaybackReady(this.dataDir, job.id)) {
      return {
        ...job,
        playbackAvailable: true,
        state: job.state === "completed" ? "completed" : "playable",
      };
    }
    return job;
  }

  findByIdentity(identity: MediaIdentity): Acquisition | undefined {
    // Require a concrete TMDb id so Jellyfin-only titles do not collide.
    if (identity.tmdbId == null) return undefined;
    return this.list().find(
      (a) =>
        a.identity.tmdbId != null &&
        a.identity.tmdbId === identity.tmdbId &&
        a.identity.mediaType === identity.mediaType &&
        (identity.mediaType !== "episode" ||
          (a.identity.seasonNumber === identity.seasonNumber &&
            a.identity.episodeNumber === identity.episodeNumber)) &&
        // Include cancelled-with-file so resume can reclaim the partial download.
        (a.state !== "cancelled" || Boolean(a.localPath && existsSync(a.localPath))),
    );
  }

  private identityKey(identity: MediaIdentity): string {
    const base = `${identity.mediaType}:${identity.tmdbId ?? "x"}`;
    if (identity.mediaType === "episode") {
      return `${base}:s${identity.seasonNumber ?? 0}e${identity.episodeNumber ?? 0}`;
    }
    return base;
  }

  cacheAvailabilityFor(identity: MediaIdentity) {
    const job = this.findByIdentity(identity);
    if (!job) return null;
    if (job.state === "cancelled" && (!job.localPath || !existsSync(job.localPath))) {
      return null;
    }
    const playable = this.isPlaybackReady(job);
    return {
      provider: "cache" as const,
      available: true,
      acquisitionId: job.id,
      localPath: job.localPath,
      bytesDownloaded: job.bytesDownloaded,
      totalBytes: job.totalBytes,
      playbackAvailable: playable,
      complete: job.state === "completed",
    };
  }

  /** True when the HLS packager has published at least one segment. */
  isPlaybackReady(job: Pick<Acquisition, "id" | "playbackAvailable">): boolean {
    return job.playbackAvailable || hlsPlaybackReady(this.dataDir, job.id);
  }

  /** Jobs the HLS packager should consider. */
  listPackagerJobs(): PackagerJob[] {
    return this.list()
      .filter(
        (a) =>
          Boolean(a.localPath) &&
          (a.state === "downloading" ||
            a.state === "playable" ||
            a.state === "queued" ||
            a.state === "completed"),
      )
      .map((a) => ({
        id: a.id,
        localPath: a.localPath!,
        downloadComplete: a.state === "completed",
        bytesDownloaded: a.bytesDownloaded,
      }));
  }

  /** Called by the packager when index.m3u8 has a media segment. */
  markHlsReady(id: string): void {
    const row = this.db
      .select()
      .from(acquisitionsTable)
      .where(eq(acquisitionsTable.id, id))
      .all()[0];
    if (!row) return;
    if (row.state === "cancelled" || row.state === "failed") return;
    if (row.playbackAvailable && row.state === "playable") return;
    this.patch(id, {
      playbackAvailable: true,
      state: row.state === "completed" ? "completed" : "playable",
    });
  }

  /** Start or reuse a CACHE acquisition for IPTV Play (single connection). */
  async ensureCacheForPlay(input: {
    identity: MediaIdentity;
    source: AcquisitionSource;
  }): Promise<Acquisition> {
    return this.start({
      identity: input.identity,
      mode: "cache",
      source: input.source,
    });
  }

  async start(input: {
    identity: MediaIdentity;
    mode: AcquisitionMode;
    source: AcquisitionSource;
  }): Promise<Acquisition> {
    const key = this.identityKey(input.identity);
    // Wait briefly if another start() for the same title is in flight.
    const waitStarted = Date.now();
    while (this.startingKeys.has(key) && Date.now() - waitStarted < 5_000) {
      await new Promise((r) => setTimeout(r, 25));
      const racing = this.findByIdentity(input.identity);
      if (
        racing &&
        (racing.state === "downloading" ||
          racing.state === "queued" ||
          (racing.state === "playable" && this.controllers.has(racing.id)))
      ) {
        return racing;
      }
    }
    this.startingKeys.add(key);
    try {
      const existing = this.findByIdentity(input.identity);
      if (
        existing &&
        (existing.state === "downloading" ||
          existing.state === "queued" ||
          (existing.state === "playable" && this.controllers.has(existing.id)))
      ) {
        return existing;
      }

      // Resume failed/cancelled/partial playable with same identity
      if (
        existing &&
        existing.localPath &&
        (existing.state === "failed" ||
          existing.state === "cancelled" ||
          existing.state === "playable")
      ) {
        const st =
          existing.localPath && existsSync(existing.localPath)
            ? statSync(existing.localPath).size
            : 0;
        // Pre-register controller so cancel() before run() is honored.
        const controller = new AbortController();
        this.controllers.set(existing.id, controller);
        this.persist({
          ...existing,
          state: "queued",
          bytesDownloaded: st,
          mode: input.mode,
          source: input.source,
          updatedAt: new Date().toISOString(),
        });
        void this.run(existing.id, controller);
        return this.get(existing.id)!;
      }

      if (existing?.state === "completed") {
        if (input.mode === "library" && existing.mode === "cache") {
          return (await this.promoteToLibrary(existing.id)) ?? existing;
        }
        return existing;
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      const localPath = join(
        this.dataDir,
        "acquisitions",
        input.mode,
        `${input.identity.mediaType}-${input.identity.tmdbId ?? "x"}-${id}.bin`,
      );

      const acquisition: Acquisition = {
        id,
        identity: input.identity,
        mode: input.mode,
        state: "queued",
        bytesDownloaded: 0,
        localPath,
        playbackAvailable: false,
        source: input.source,
        createdAt: now,
        updatedAt: now,
      };
      const controller = new AbortController();
      this.controllers.set(id, controller);
      this.persist(acquisition);
      void this.run(id, controller);
      return acquisition;
    } finally {
      this.startingKeys.delete(key);
    }
  }

  async cancel(id: string): Promise<Acquisition | undefined> {
    const job = this.get(id);
    if (!job) return undefined;
    this.controllers.get(id)?.abort();
    removeHlsDir(this.dataDir, id);
    return this.patch(id, { state: "cancelled", playbackAvailable: false });
  }

  /** Atomic cache → library promotion without re-download. */
  async promoteToLibrary(
    id: string,
    meta?: LibraryNamingMeta | null,
  ): Promise<Acquisition | undefined> {
    const job = this.get(id);
    if (!job?.localPath || !existsSync(job.localPath)) return undefined;
    if (job.mode === "library" && job.state === "completed") return job;

    // If still downloading, upgrade mode in-flight — destination stays until complete, then move.
    if (job.state === "downloading" || job.state === "queued" || job.state === "playable") {
      return this.patch(id, { mode: "library" });
    }

    const dest = await this.libraryDest(job.identity, meta);
    await mkdir(dirname(dest), { recursive: true });
    renameSync(job.localPath, dest);
    removeHlsDir(this.dataDir, id);
    const updated = this.patch(id, {
      mode: "library",
      localPath: dest,
      state: "completed",
      playbackAvailable: true,
    });
    void this.notifyLibraryPromoted(dest);
    return updated;
  }

  openLocalFile(id: string): { stream: ReturnType<typeof createReadStream>; size: number } | null {
    const meta = this.openLocalFileMeta(id);
    if (!meta) return null;
    this.cacheManager?.touch(id);
    return { stream: createReadStream(meta.path), size: meta.size };
  }

  openLocalFileMeta(id: string): { path: string; size: number } | null {
    const job = this.get(id);
    if (!job?.localPath || !existsSync(job.localPath)) return null;
    const st = statSync(job.localPath);
    if (st.size < 1_000_000 && !job.playbackAvailable) return null;
    return { path: job.localPath, size: st.size };
  }

  private async run(id: string, existingController?: AbortController): Promise<void> {
    const job = this.get(id);
    if (!job?.localPath) return;
    if (job.state === "cancelled") {
      this.controllers.delete(id);
      return;
    }
    if (!(this.dispatcharr instanceof DispatcharrProvider)) {
      this.patch(id, { state: "failed" });
      this.controllers.delete(id);
      return;
    }

    const controller = existingController ?? new AbortController();
    if (!this.controllers.has(id)) this.controllers.set(id, controller);
    if (controller.signal.aborted || this.get(id)?.state === "cancelled") {
      this.patch(id, { state: "cancelled" });
      this.controllers.delete(id);
      return;
    }
    this.patch(id, { state: "downloading" });

    let lease: { release: () => void; signal: AbortSignal } | undefined;
    try {
      lease = this.iptvConnections?.acquire("acquisition", {
        label: `acq:${id}`,
        signal: controller.signal,
      });

      // Preempt / forceRelease aborts lease.signal — abort the job controller too.
      if (lease) {
        const onLeaseAbort = () => {
          try {
            if (!controller.signal.aborted) controller.abort();
          } catch {
            /* ignore */
          }
        };
        if (lease.signal.aborted) onLeaseAbort();
        else lease.signal.addEventListener("abort", onLeaseAbort, { once: true });
      }

      const existing =
        existsSync(job.localPath) ? statSync(job.localPath).size : 0;
      const kind = job.source.episodeId ? "episode" : "movie";
      const upstream = await this.dispatcharr.openVodStream({
        uuid: job.source.uuid,
        kind,
        streamId: job.source.streamId,
        range: existing > 0 ? `bytes=${existing}-` : undefined,
        signal: controller.signal,
      });

      await this.transport.pipeResponse({
        response: upstream,
        destPath: job.localPath,
        resumeFromBytes: existing,
        signal: controller.signal,
        onProgress: (bytes, total) => {
          if (this.get(id)?.state === "cancelled") return;
          // Playability comes from the HLS packager (first segment), not byte thresholds.
          const cur = this.get(id);
          const hlsReady = cur ? this.isPlaybackReady(cur) : false;
          this.patch(id, {
            bytesDownloaded: bytes,
            totalBytes: total,
            playbackAvailable: hlsReady,
            state: hlsReady ? "playable" : "downloading",
          });
        },
      });

      const finalJob = this.get(id);
      // Connection released when upstream body ends.
      if (finalJob?.mode === "library" && finalJob.localPath) {
        const dest = await this.libraryDest(finalJob.identity);
        if (finalJob.localPath !== dest && existsSync(finalJob.localPath)) {
          await mkdir(dirname(dest), { recursive: true });
          renameSync(finalJob.localPath, dest);
          this.patch(id, {
            state: "completed",
            localPath: dest,
            playbackAvailable: true,
            bytesDownloaded: existsSync(dest) ? statSync(dest).size : finalJob.bytesDownloaded,
          });
          void this.notifyLibraryPromoted(dest);
          this.cacheManager?.evict();
          return;
        }
      }

      this.patch(id, {
        state: "completed",
        playbackAvailable: true,
        bytesDownloaded: existsSync(job.localPath)
          ? statSync(job.localPath).size
          : job.bytesDownloaded,
      });
      this.cacheManager?.evict();
    } catch (err) {
      if (controller.signal.aborted) {
        this.patch(id, { state: "cancelled" });
      } else {
        this.patch(id, { state: "failed" });
        console.error("[acquisition]", id, err);
      }
    } finally {
      lease?.release();
      this.controllers.delete(id);
    }
  }

  private async notifyLibraryPromoted(localPath: string): Promise<void> {
    if (!this.onLibraryPromoted) return;
    try {
      await this.onLibraryPromoted(localPath);
    } catch (err) {
      console.error("[acquisition] jellyfin library notify failed", err);
    }
  }

  private patch(id: string, patch: Partial<Acquisition>): Acquisition | undefined {
    const cur = this.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.persist(next);
    return next;
  }

  private persist(a: Acquisition): void {
    this.db
      .insert(acquisitionsTable)
      .values({
        id: a.id,
        tmdbId: a.identity.tmdbId,
        mediaType: a.identity.mediaType,
        mode: a.mode,
        state: a.state,
        bytesDownloaded: a.bytesDownloaded,
        totalBytes: a.totalBytes,
        localPath: a.localPath,
        playbackAvailable: a.playbackAvailable,
        sourceJson: JSON.stringify(a.source),
        identityJson: JSON.stringify(a.identity),
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })
      .onConflictDoUpdate({
        target: acquisitionsTable.id,
        set: {
          mode: a.mode,
          state: a.state,
          bytesDownloaded: a.bytesDownloaded,
          totalBytes: a.totalBytes,
          localPath: a.localPath,
          playbackAvailable: a.playbackAvailable,
          sourceJson: JSON.stringify(a.source),
          identityJson: JSON.stringify(a.identity),
          updatedAt: a.updatedAt,
        },
      })
      .run();
  }

  private rowToAcquisition(row: typeof acquisitionsTable.$inferSelect): Acquisition {
    const mode = row.mode as AcquisitionMode;
    const updatedAt = row.updatedAt;
    return {
      id: row.id,
      identity: JSON.parse(row.identityJson) as MediaIdentity,
      mode,
      state: row.state as Acquisition["state"],
      bytesDownloaded: row.bytesDownloaded,
      totalBytes: row.totalBytes ?? undefined,
      localPath: row.localPath ?? undefined,
      playbackAvailable: Boolean(row.playbackAvailable),
      source: JSON.parse(row.sourceJson) as AcquisitionSource,
      createdAt: row.createdAt,
      updatedAt,
      cacheExpiresAt:
        mode === "cache" ? cacheExpiresAtIso(updatedAt, this.cacheTtlMs) : undefined,
    };
  }
}

export function cacheExpiresAtIso(updatedAt: string, ttlMs: number): string {
  const base = Date.parse(updatedAt);
  const at = Number.isFinite(base) ? base + ttlMs : Date.now() + ttlMs;
  return new Date(at).toISOString();
}
