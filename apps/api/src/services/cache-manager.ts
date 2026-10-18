import { existsSync, unlinkSync, statSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { acquisitions as acquisitionsTable } from "../db/schema.js";
import { removeHlsDir } from "./hls-paths.js";

export interface CacheManagerOptions {
  /** Max total bytes for cache-mode acquisitions on disk. */
  maxBytes: number;
  /** Evict completed cache entries older than this. */
  ttlMs: number;
  /** Protect files touched (played) within this window. */
  protectMs?: number;
  /** Data dir for HLS sidecar cleanup. */
  dataDir?: string;
}

/**
 * TTL + LRU eviction for Reclinarr CACHE acquisitions.
 * Never touches library-mode files or in-flight downloads.
 */
export class CacheManager {
  private readonly protectMs: number;
  private readonly touched = new Map<string, number>();

  constructor(
    private readonly db: AppDb,
    private readonly opts: CacheManagerOptions,
  ) {
    this.protectMs = opts.protectMs ?? 5 * 60_000;
  }

  /** Mark a cache file as recently played so eviction skips it briefly. */
  touch(acquisitionId: string): void {
    this.touched.set(acquisitionId, Date.now());
  }

  /** Run eviction once. Returns number of deleted acquisitions. */
  evict(): number {
    const now = Date.now();
    const rows = this.db
      .select()
      .from(acquisitionsTable)
      .all()
      .filter((r) => r.mode === "cache");

    let deleted = 0;

    // 1) TTL: completed/cancelled/failed cache files past TTL
    for (const row of rows) {
      if (!this.isIdle(row.state)) continue;
      if (this.isProtected(row.id, now)) continue;
      const updated = Date.parse(row.updatedAt);
      if (!Number.isFinite(updated) || now - updated < this.opts.ttlMs) continue;
      if (this.remove(row.id, row.localPath)) deleted += 1;
    }

    // 2) Size: LRU among remaining idle cache files
    const remaining = this.db
      .select()
      .from(acquisitionsTable)
      .all()
      .filter((r) => r.mode === "cache" && this.isIdle(r.state));

    let total = 0;
    const sized = remaining.map((r) => {
      const size =
        r.localPath && existsSync(r.localPath)
          ? statSync(r.localPath).size
          : r.bytesDownloaded || 0;
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
