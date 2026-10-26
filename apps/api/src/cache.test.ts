import { afterEach, describe, expect, it, vi } from "vitest";
import type { Media } from "@reclinarr/shared";
import { MemoryCache, invalidateSeerrTitle, withSeerrCache } from "./cache.js";

afterEach(() => vi.useRealTimers());

describe("MemoryCache", () => {
  it("expires entries after the ttl", () => {
    vi.useFakeTimers();
    const cache = new MemoryCache();
    cache.set("a", 1, 1000);
    expect(cache.get("a")).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts the oldest entry past the cap", () => {
    const cache = new MemoryCache(2);
    cache.set("a", 1, 1000);
    cache.set("b", 2, 1000);
    cache.set("c", 3, 1000);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("drops expired entries before evicting live ones", () => {
    vi.useFakeTimers();
    const cache = new MemoryCache(2);
    cache.set("old", 1, 10);
    cache.set("live", 2, 1000);
    vi.advanceTimersByTime(11);
    cache.set("new", 3, 1000);
    expect(cache.get("live")).toBe(2);
    expect(cache.get("new")).toBe(3);
  });

  it("shares one loader run between concurrent callers", async () => {
    const cache = new MemoryCache();
    const loader = vi.fn(async () => "value");
    const [a, b] = await Promise.all([
      cache.getOrLoad("k", 1000, loader),
      cache.getOrLoad("k", 1000, loader),
    ]);
    expect([a, b]).toEqual(["value", "value"]);
    await cache.getOrLoad("k", 1000, loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed load", async () => {
    const cache = new MemoryCache();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    await expect(cache.getOrLoad("k", 1000, loader)).rejects.toThrow("boom");
    await expect(cache.getOrLoad("k", 1000, loader)).resolves.toBe("ok");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

function media(title: string): Media {
  return { metadata: { title }, availability: [] } as unknown as Media;
}

function fakeSeerr() {
  return {
    discoverTrending: vi.fn(async () => [media("t")]),
    discoverMovies: vi.fn(async (_opts?: { page?: number; genreId?: number }) => [media("m")]),
    getDetails: vi.fn(async (_type: "movie" | "tv", _id: number) => media("d")),
    listTvEpisodes: vi.fn(async (_id: number) => [media("e")]),
    async getRequestAvailability(type: "movie" | "tv", id: number) {
      return this.getDetails(type, id);
    },
  };
}

describe("withSeerrCache", () => {
  it("serves repeat calls from the cache and keys by arguments", async () => {
    const seerr = fakeSeerr();
    const cached = withSeerrCache(seerr, new MemoryCache());
    await cached.discoverMovies({ page: 1, genreId: 1 });
    await cached.discoverMovies({ page: 1, genreId: 1 });
    await cached.discoverMovies({ page: 1, genreId: 2 });
    expect(seerr.discoverMovies).toHaveBeenCalledTimes(2);
  });

  it("returns clones so callers cannot corrupt cached data", async () => {
    const cached = withSeerrCache(fakeSeerr(), new MemoryCache());
    const first = await cached.discoverTrending();
    first[0]!.metadata.title = "mutated";
    const second = await cached.discoverTrending();
    expect(second[0]!.metadata.title).toBe("t");
  });

  it("routes internal provider calls through the cache", async () => {
    const seerr = fakeSeerr();
    const cached = withSeerrCache(seerr, new MemoryCache());
    await cached.getDetails("movie", 1);
    await cached.getRequestAvailability("movie", 1);
    expect(seerr.getDetails).toHaveBeenCalledTimes(1);
  });

  it("refetches a title after invalidation", async () => {
    const seerr = fakeSeerr();
    const cache = new MemoryCache();
    const cached = withSeerrCache(seerr, cache);
    await cached.getDetails("movie", 7);
    await cached.getDetails("tv", 7);
    await cached.listTvEpisodes(7);
    await cached.getDetails("movie", 8);
    invalidateSeerrTitle(cache, 7);
    await cached.getDetails("movie", 7);
    await cached.getDetails("tv", 7);
    await cached.listTvEpisodes(7);
    await cached.getDetails("movie", 8);
    expect(seerr.getDetails).toHaveBeenCalledTimes(5);
    expect(seerr.listTvEpisodes).toHaveBeenCalledTimes(2);
  });
});
