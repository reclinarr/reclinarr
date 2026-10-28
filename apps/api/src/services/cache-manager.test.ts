import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MediaIdentity } from "@reclinarr/shared";
import { createDb } from "../db/client.js";
import { acquisitions, playbackProgress } from "../db/schema.js";
import { CacheManager } from "./cache-manager.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function seedCache(
  db: ReturnType<typeof createDb>,
  opts: {
    id: string;
    path: string;
    bytes: number;
    updatedAt: string;
    state?: string;
    identity?: MediaIdentity;
  },
) {
  const identity = opts.identity ?? { tmdbId: 1, mediaType: "movie" as const };
  writeFileSync(opts.path, Buffer.alloc(opts.bytes));
  db.insert(acquisitions)
    .values({
      id: opts.id,
      tmdbId: identity.tmdbId,
      mediaType: identity.mediaType,
      mode: "cache",
      state: opts.state ?? "completed",
      bytesDownloaded: opts.bytes,
      totalBytes: opts.bytes,
      localPath: opts.path,
      playbackAvailable: true,
      sourceJson: "{}",
      identityJson: JSON.stringify(identity),
      createdAt: opts.updatedAt,
      updatedAt: opts.updatedAt,
    })
    .run();
}

function seedProgress(
  db: ReturnType<typeof createDb>,
  identity: MediaIdentity,
  opts: { position: number; duration: number; at: number },
) {
  db.insert(playbackProgress)
    .values({
      id: `u:${identity.mediaType}:${identity.tmdbId}:${identity.seasonNumber ?? ""}:${identity.episodeNumber ?? ""}`,
      userId: "u",
      tmdbId: identity.tmdbId,
      mediaType: identity.mediaType,
      seasonNumber: identity.seasonNumber,
      episodeNumber: identity.episodeNumber,
      provider: "dispatcharr",
      positionSeconds: opts.position,
      durationSeconds: opts.duration,
      completed: opts.position / opts.duration >= 0.9,
      updatedAt: new Date(opts.at),
    })
    .run();
}

function episode(season: number, ep: number): MediaIdentity {
  return { tmdbId: 50, mediaType: "episode", seasonNumber: season, episodeNumber: ep };
}

describe("CacheManager", () => {
  it("evicts completed cache files past TTL", () => {
    const dir = mkdtempSync(join(tmpdir(), "reclinarr-cache-"));
    const db = createDb(dir);
    const oldPath = join(dir, "old.bin");
    const newPath = join(dir, "new.bin");
    const oldAt = new Date(Date.now() - 10 * DAY).toISOString();
    const newAt = new Date().toISOString();
    seedCache(db, { id: "old", path: oldPath, bytes: 1000, updatedAt: oldAt });
    seedCache(db, { id: "new", path: newPath, bytes: 1000, updatedAt: newAt });

    const mgr = new CacheManager(db, {
      maxBytes: 100_000_000,
      ttlMs: 7 * DAY,
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

    const mgr = new CacheManager(db, { maxBytes: 1000, ttlMs: 365 * DAY });
    mgr.touch("a");
    const n = mgr.evict();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(existsSync(aPath)).toBe(true);
  });

  it("counts each file's HLS sidecar against the size budget", () => {
    const dir = mkdtempSync(join(tmpdir(), "reclinarr-cache-"));
    const db = createDb(dir);
    const t = new Date(Date.now() - DAY).toISOString();
    const older = new Date(Date.now() - 2 * DAY).toISOString();
    seedCache(db, { id: "a", path: join(dir, "a.bin"), bytes: 600, updatedAt: older });
    seedCache(db, { id: "b", path: join(dir, "b.bin"), bytes: 600, updatedAt: t });
    mkdirSync(join(dir, "hls", "a"), { recursive: true });
    writeFileSync(join(dir, "hls", "a", "seg0.ts"), Buffer.alloc(600));

    // Files alone (1200) fit in 1500; with a's 600-byte sidecar (1800) they do not.
    const mgr = new CacheManager(db, { maxBytes: 1500, ttlMs: 365 * DAY, dataDir: dir });
    expect(mgr.evict()).toBe(1);
    expect(existsSync(join(dir, "a.bin"))).toBe(false);
    expect(existsSync(join(dir, "b.bin"))).toBe(true);
  });

  it("evicts a film 24h after it was watched past 95%, keeps one watched less", () => {
    const dir = mkdtempSync(join(tmpdir(), "reclinarr-cache-"));
    const db = createDb(dir);
    const now = Date.now();
    const downloaded = new Date(now - 2 * DAY).toISOString();
    const watched = { tmdbId: 1, mediaType: "movie" as const };
    const partial = { tmdbId: 2, mediaType: "movie" as const };
    const fresh = { tmdbId: 3, mediaType: "movie" as const };
    seedCache(db, { id: "watched", path: join(dir, "w.bin"), bytes: 10, updatedAt: downloaded, identity: watched });
    seedCache(db, { id: "partial", path: join(dir, "p.bin"), bytes: 10, updatedAt: downloaded, identity: partial });
    seedCache(db, { id: "fresh", path: join(dir, "f.bin"), bytes: 10, updatedAt: downloaded, identity: fresh });
    seedProgress(db, watched, { position: 5800, duration: 6000, at: now - 25 * HOUR });
    seedProgress(db, partial, { position: 5000, duration: 6000, at: now - 25 * HOUR });
    seedProgress(db, fresh, { position: 5900, duration: 6000, at: now - 2 * HOUR });

    const mgr = new CacheManager(db, { maxBytes: 100_000_000, ttlMs: 7 * DAY, watchedTtlMs: DAY });
    expect(mgr.evict()).toBe(1);
    expect(existsSync(join(dir, "w.bin"))).toBe(false);
    expect(existsSync(join(dir, "p.bin"))).toBe(true);
    expect(existsSync(join(dir, "f.bin"))).toBe(true);
    expect(mgr.expiresAtMs(fresh, downloaded)).toBe(now - 2 * HOUR + DAY);
  });

  it("frees watched earlier episodes when the next one starts", () => {
    const dir = mkdtempSync(join(tmpdir(), "reclinarr-cache-"));
    const db = createDb(dir);
    const now = Date.now();
    const t = new Date(now - HOUR).toISOString();
    seedCache(db, { id: "e1", path: join(dir, "e1.bin"), bytes: 10, updatedAt: t, identity: episode(1, 1) });
    seedCache(db, { id: "e2", path: join(dir, "e2.bin"), bytes: 10, updatedAt: t, identity: episode(1, 2) });
    seedCache(db, { id: "e3", path: join(dir, "e3.bin"), bytes: 10, updatedAt: t, identity: episode(1, 3) });
    seedProgress(db, episode(1, 1), { position: 2700, duration: 2800, at: now - HOUR });
    seedProgress(db, episode(1, 2), { position: 600, duration: 2800, at: now - HOUR });

    const mgr = new CacheManager(db, { maxBytes: 100_000_000, ttlMs: 7 * DAY });
    // Recently played files are still freed once the user moves on.
    mgr.touch("e1");
    const touchedAt = Date.now() - 10 * 60_000;
    (mgr as unknown as { touched: Map<string, number> }).touched.set("e1", touchedAt);

    expect(mgr.evictWatchedBefore(episode(1, 3))).toBe(1);
    expect(existsSync(join(dir, "e1.bin"))).toBe(false);
    // Unfinished earlier episode and the one being played stay.
    expect(existsSync(join(dir, "e2.bin"))).toBe(true);
    expect(existsSync(join(dir, "e3.bin"))).toBe(true);
  });

  it("does not free a watched episode that is still streaming", () => {
    const dir = mkdtempSync(join(tmpdir(), "reclinarr-cache-"));
    const db = createDb(dir);
    const now = Date.now();
    seedCache(db, {
      id: "e1",
      path: join(dir, "e1.bin"),
      bytes: 10,
      updatedAt: new Date(now - HOUR).toISOString(),
      identity: episode(1, 1),
    });
    seedProgress(db, episode(1, 1), { position: 2700, duration: 2800, at: now });

    const mgr = new CacheManager(db, { maxBytes: 100_000_000, ttlMs: 7 * DAY });
    mgr.touch("e1");
    expect(mgr.evictWatchedBefore(episode(1, 2))).toBe(0);
    expect(existsSync(join(dir, "e1.bin"))).toBe(true);
  });
});
