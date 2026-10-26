import type { Media } from "@reclinarr/shared";

export interface CacheStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  delete(key: string): void;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 500;

/** In-memory TTL cache with a size cap and in-flight de-duplication. */
export class MemoryCache implements CacheStore {
  private readonly store = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.store.size > this.maxEntries) this.purgeExpired();
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  /** Concurrent callers for one key share a single loader run; a rejected load is not cached. */
  async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const run = loader()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }
}

const DISCOVERY_TTL_MS = 15 * 60_000;
const SIMILAR_TTL_MS = 60 * 60_000;
const DETAILS_TTL_MS = 5 * 60_000;

interface CacheableSeerr {
  discoverTrending(opts?: { page?: number; mediaType?: "movie" | "tv" }): Promise<Media[]>;
  discoverMovies?(opts?: { page?: number; genreId?: number }): Promise<Media[]>;
  discoverTv?(opts?: { page?: number; genreId?: number }): Promise<Media[]>;
  getSimilar?(mediaType: "movie" | "tv", tmdbId: number): Promise<Media[]>;
  getDetails?(mediaType: "movie" | "tv", tmdbId: number): Promise<Media | null>;
  listTvEpisodes(tmdbId: number): Promise<Media[]>;
}

/**
 * Seerr authenticates with one API key, so its read responses are the same for every user and
 * safe to share. Callers get a clone because merge helpers build on the returned objects.
 */
export function withSeerrCache<T extends CacheableSeerr>(seerr: T, cache: MemoryCache): T {
  const cached = Object.create(seerr) as T;
  const wrap = <A extends unknown[], R>(
    name: string,
    ttlMs: number,
    original: (...args: A) => Promise<R>,
  ) => {
    return async (...args: A): Promise<R> =>
      structuredClone(
        await cache.getOrLoad(`seerr:${name}:${JSON.stringify(args)}`, ttlMs, () =>
          original.apply(seerr, args),
        ),
      );
  };

  cached.discoverTrending = wrap("trending", DISCOVERY_TTL_MS, seerr.discoverTrending);
  if (seerr.discoverMovies) {
    cached.discoverMovies = wrap("movies", DISCOVERY_TTL_MS, seerr.discoverMovies);
  }
  if (seerr.discoverTv) cached.discoverTv = wrap("tv", DISCOVERY_TTL_MS, seerr.discoverTv);
  if (seerr.getSimilar) cached.getSimilar = wrap("similar", SIMILAR_TTL_MS, seerr.getSimilar);
  if (seerr.getDetails) cached.getDetails = wrap("details", DETAILS_TTL_MS, seerr.getDetails);
  cached.listTvEpisodes = wrap("episodes", DETAILS_TTL_MS, seerr.listTvEpisodes);
  return cached;
}

/** Drops cached Seerr details and episodes for a title, e.g. after a request changes its status. */
export function invalidateSeerrTitle(cache: MemoryCache, tmdbId: number): void {
  cache.delete(`seerr:details:${JSON.stringify(["movie", tmdbId])}`);
  cache.delete(`seerr:details:${JSON.stringify(["tv", tmdbId])}`);
  cache.delete(`seerr:episodes:${JSON.stringify([tmdbId])}`);
}
