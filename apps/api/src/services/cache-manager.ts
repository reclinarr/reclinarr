import { existsSync, unlinkSync, statSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import type { MediaIdentity } from "@reclinarr/shared";
import type { AppDb } from "../db/client.js";
import { acquisitions as acquisitionsTable, playbackProgress } from "../db/schema.js";
import { hlsDirBytes, removeHlsDir } from "./hls-paths.js";

export interface CacheManagerOptions {
  /** Max total bytes for cache-mode acquisitions on disk. */
  maxBytes: number;
  /** Evict completed cache entries older than this. */
  ttlMs: number;
  /** Evict cache entries this long after someone watched past `watchedRatio`. */
  watchedTtlMs?: number;
  /** Fraction of the runtime that counts as "watched" (default 0.95). */
  watchedRatio?: number;
  /** Protect files touched (played) within this window. */
  protectMs?: number;
  /** Data dir for HLS sidecar cleanup. */
  dataDir?: string;
}

type AcquisitionRow = typeof acquisitionsTable.$inferSelect;

/** Episodes still streaming segments within this window are never deleted early. */
const ACTIVE_STREAM_MS = 2 * 60_000;

/**
 * TTL + watched + LRU eviction for Reclinarr CACHE acquisitions.
 * Never touches library-mode files or in-flight downloads.
 */
export class CacheManager {
  private readonly protectMs: number;
  private readonly watchedTtlMs: number;
  private readonly watchedRatio: number;
  private readonly touched = new Map<string, number>();

  constructor(
    private readonly db: AppDb,
    private readonly opts: CacheManagerOptions,
  ) {
    this.protectMs = opts.protectMs ?? 5 * 60_000;
    this.watchedTtlMs = opts.watchedTtlMs ?? 24 * 60 * 60_000;
    this.watchedRatio = opts.watchedRatio ?? 0.95;
  }

  /** Mark a cache file as recently played so eviction skips it briefly. */
  touch(acquisitionId: string): void {
    this.touched.set(acquisitionId, Date.now());
  }

  /**
   * When an expiry is due for a cache file: `ttlMs` after download, or
   * `watchedTtlMs` after it was watched past `watchedRatio` — whichever is sooner.
   */
  expiresAtMs(identity: MediaIdentity, updatedAt: string): number {
    const base = Date.parse(updatedAt);
    const ttlAt = (Number.isFinite(base) ? base : Date.now()) + this.opts.ttlMs;
    const watchedAt = this.watchedAtMs(identity);
    return watchedAt == null ? ttlAt : Math.min(ttlAt, watchedAt + this.watchedTtlMs);
  }

  /**
   * Playing episode N frees earlier cached episodes of the same series that
   * were already watched — binge-watching keeps roughly one episode on disk.
   */
  evictWatchedBefore(identity: MediaIdentity): number {
    if (identity.mediaType !== "episode" || identity.tmdbId == null) return 0;
    const season = identity.seasonNumber ?? 0;
    const episode = identity.episodeNumber ?? 0;
    const now = Date.now();
    let deleted = 0;
    for (const row of this.idleCacheRows()) {
      const rowIdentity = parseIdentity(row);
      if (!rowIdentity || rowIdentity.mediaType !== "episode") continue;
      if (rowIdentity.tmdbId !== identity.tmdbId) continue;
      const rowSeason = rowIdentity.seasonNumber ?? 0;
      const rowEpisode = rowIdentity.episodeNumber ?? 0;
      const before = rowSeason < season || (rowSeason === season && rowEpisode < episode);
      if (!before) continue;
      if (this.watchedAtMs(rowIdentity) == null) continue;
      const touchedAt = this.touched.get(row.id);
      if (touchedAt != null && now - touchedAt < ACTIVE_STREAM_MS) continue;
      if (this.remove(row.id, row.localPath)) deleted += 1;
    }
    return deleted;
  }

  /** Run eviction once. Returns number of deleted acquisitions. */
  evict(): number {
    const now = Date.now();
    let deleted = 0;

    // 1) TTL / watched: idle cache files past their expiry
    for (const row of this.idleCacheRows()) {
      if (this.isProtected(row.id, now)) continue;
      const identity = parseIdentity(row);
      const expiresAt = identity
        ? this.expiresAtMs(identity, row.updatedAt)
        : Date.parse(row.updatedAt) + this.opts.ttlMs;
      if (!Number.isFinite(expiresAt) || now < expiresAt) continue;
      if (this.remove(row.id, row.localPath)) deleted += 1;
    }

    // 2) Size: LRU among remaining idle cache files
    let total = 0;
    const sized = this.idleCacheRows().map((r) => {
      const fileBytes =
        r.localPath && existsSync(r.localPath)
          ? statSync(r.localPath).size
          : r.bytesDownloaded || 0;
      // The HLS sidecar is about as large as the file itself and counts against the budget too.
      const size = fileBytes + (this.opts.dataDir ? hlsDirBytes(this.opts.dataDir, r.id) : 0);
      total += size;
      return { row: r, size };
    });

    if (total <= this.opts.maxBytes) return deleted;

    sized.sort(
      (a, b) => Date.parse(a.row.updatedAt) - Date.parse(b.row.updatedAt),
    );

    for (const entry of sized) {
      if (total <= this.opts.maxBytes) break;
      if (this.isProtected(entry.row.id, now)) continue;
      if (this.remove(entry.row.id, entry.row.localPath)) {
        total -= entry.size;
        deleted += 1;
      }
    }

    return deleted;
  }

  /** Latest time any user watched this title past `watchedRatio`, or null. */
  private watchedAtMs(identity: MediaIdentity): number | null {
    if (identity.tmdbId == null) return null;
    const rows = this.db
      .select()
      .from(playbackProgress)
      .where(
        and(
          eq(playbackProgress.tmdbId, identity.tmdbId),
          eq(playbackProgress.mediaType, identity.mediaType),
        ),
      )
      .all();
    let latest: number | null = null;
    for (const r of rows) {
      if (identity.mediaType === "episode") {
        if ((r.seasonNumber ?? 0) !== (identity.seasonNumber ?? 0)) continue;
        if ((r.episodeNumber ?? 0) !== (identity.episodeNumber ?? 0)) continue;
      }
      const duration = r.durationSeconds ?? 0;
      if (duration <= 0 || r.positionSeconds / duration < this.watchedRatio) continue;
      const at = r.updatedAt instanceof Date ? r.updatedAt.getTime() : Number(r.updatedAt);
      if (Number.isFinite(at) && (latest == null || at > latest)) latest = at;
    }
    return latest;
  }

  private idleCacheRows(): AcquisitionRow[] {
    return this.db
      .select()
      .from(acquisitionsTable)
      .all()
      .filter((r) => r.mode === "cache" && this.isIdle(r.state));
  }

  private isIdle(state: string): boolean {
    return state === "completed" || state === "cancelled" || state === "failed";
  }

  private isProtected(id: string, now: number): boolean {
    const at = this.touched.get(id);
    return at != null && now - at < this.protectMs;
  }

  private remove(id: string, localPath: string | null): boolean {
    try {
      if (localPath && existsSync(localPath)) unlinkSync(localPath);
    } catch {
      return false;
    }
    if (this.opts.dataDir) removeHlsDir(this.opts.dataDir, id);
    this.db.delete(acquisitionsTable).where(eq(acquisitionsTable.id, id)).run();
    this.touched.delete(id);
    return true;
  }
}

function parseIdentity(row: AcquisitionRow): MediaIdentity | null {
  try {
    return JSON.parse(row.identityJson) as MediaIdentity;
  } catch {
    return null;
  }
}
