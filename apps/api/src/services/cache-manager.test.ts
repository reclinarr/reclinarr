import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "../db/client.js";
import { acquisitions } from "../db/schema.js";
import { CacheManager } from "./cache-manager.js";

function seedCache(
  db: ReturnType<typeof createDb>,
  opts: { id: string; path: string; bytes: number; updatedAt: string; state?: string },
) {
  writeFileSync(opts.path, Buffer.alloc(opts.bytes));
  db.insert(acquisitions)
    .values({
      id: opts.id,
      tmdbId: 1,
      mediaType: "movie",
      mode: "cache",
      state: opts.state ?? "completed",
      bytesDownloaded: opts.bytes,
      totalBytes: opts.bytes,
      localPath: opts.path,
      playbackAvailable: true,
      sourceJson: "{}",
      identityJson: JSON.stringify({ tmdbId: 1, mediaType: "movie" }),
      createdAt: opts.updatedAt,
      updatedAt: opts.updatedAt,
    })
    .run();
}

describe("CacheManager", () => {
  it("evicts completed cache files past TTL", () => {
    const dir = mkdtempSync(join(tmpdir(), "reclinarr-cache-"));
    const db = createDb(dir);
    const oldPath = join(dir, "old.bin");
    const newPath = join(dir, "new.bin");
    const oldAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const newAt = new Date().toISOString();
    seedCache(db, { id: "old", path: oldPath, bytes: 1000, updatedAt: oldAt });
    seedCache(db, { id: "new", path: newPath, bytes: 1000, updatedAt: newAt });

    const mgr = new CacheManager(db, {
      maxBytes: 100_000_000,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
    });
    const n = mgr.evict();
    expect(n).toBe(1);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
  });

  it("protects recently touched files from LRU eviction", () => {
    const dir = mkdtempSync(join(tmpdir(), "reclinarr-cache-"));
    const db = createDb(dir);
    const aPath = join(dir, "a.bin");
    const bPath = join(dir, "b.bin");
    const t = new Date().toISOString();
    seedCache(db, { id: "a", path: aPath, bytes: 800, updatedAt: t });
    seedCache(db, { id: "b", path: bPath, bytes: 800, updatedAt: t });

    const mgr = new CacheManager(db, { maxBytes: 1000, ttlMs: 365 * 24 * 60 * 60 * 1000 });
    mgr.touch("a");
    const n = mgr.evict();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(existsSync(aPath)).toBe(true);
  });
});
