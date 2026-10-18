import { describe, expect, it, vi } from "vitest";
import type { MediaIdentity, PlaybackSource } from "@reclinarr/shared";
import { PlaybackResolver } from "./playback-resolver.js";

describe("PlaybackResolver IPTV auto-cache", () => {
  const identity: MediaIdentity = { tmdbId: 550, mediaType: "movie" };

  it("plays the first regular playable episode when a series has no resume", async () => {
    const source: PlaybackSource = { provider: "jellyfin", delivery: { mode: "proxy", url: "/episode" }, directPlay: true };
    const episode = (season: number, number: number, playable = true) => ({
      identity: { mediaType: "episode", tmdbId: 42, jellyfinItemId: `episode-${season}-${number}`, seasonNumber: season, episodeNumber: number },
      metadata: { title: "Episode" },
      availability: [{ provider: "jellyfin", canPlay: playable, available: playable }],
    });
    const jellyfin = {
      findByTmdb: vi.fn(async () => ({ identity: { jellyfinItemId: "series" } })),
      listEpisodesForSeries: vi.fn(async () => [episode(0, 1), episode(2, 1), episode(1, 2), episode(1, 1, false)]),
      resolvePlayback: vi.fn(async (_context: unknown, _identity: MediaIdentity) => source),
    };
    const resolver = new PlaybackResolver(jellyfin as never, {} as never);
    const result = await resolver.resolve({ jellyfinUserId: "viewer" } as never, { mediaType: "tv", tmdbId: 42 });
    expect(result?.status).toBe("ready");
    expect(jellyfin.resolvePlayback.mock.calls[0]?.[1]).toMatchObject({ mediaType: "episode", seasonNumber: 1, episodeNumber: 2 });
    if (result?.status === "ready") expect(result.source.resolvedIdentity?.jellyfinItemId).toBe("episode-1-2");
  });

  it("selects the recently watched IPTV episode rather than restarting the series", async () => {
    const episode = (number: number) => ({
      identity: { mediaType: "episode", tmdbId: 42, seasonNumber: 1, episodeNumber: number },
      metadata: { title: "Episode" },
      availability: [{ provider: "dispatcharr", canPlay: true, available: true, uuid: `uuid-${number}`, candidates: [] }],
    });
    const dispatcharr = {
      resolveVodPlayback: true,
      findVodByTmdb: vi.fn(async () => ({ availability: [{ provider: "dispatcharr", seriesId: 1 }] })),
      listEpisodesForSeries: vi.fn(async () => [episode(1), episode(2)]),
    };
    const progress = {
      listInProgressForSeries: () => [{ seasonNumber: 1, episodeNumber: 2 }],
      get: () => ({ positionSeconds: 120, completed: false }),
    };
    const acquisitions = {
      cacheAvailabilityFor: () => ({ playbackAvailable: true, acquisitionId: "episode-cache", complete: true }),
      get: () => ({}),
    };
    const resolver = new PlaybackResolver({ findByTmdb: async () => null } as never, dispatcharr as never, undefined, acquisitions as never, undefined, undefined, progress as never);
    const result = await resolver.resolve({ jellyfinUserId: "viewer" } as never, { mediaType: "tv", tmdbId: 42 });
    if (result?.status !== "ready") throw new Error("Expected playable cache");
    expect(result.source.resolvedIdentity).toMatchObject({ mediaType: "episode", seasonNumber: 1, episodeNumber: 2 });
    expect(result.source.startPositionSeconds).toBe(120);
  });

  it("returns buffering when cache starts but is not yet playable", async () => {
    const ensureCacheForPlay = vi.fn(async () => ({
      id: "acq-1",
      identity,
      mode: "cache" as const,
      state: "downloading" as const,
      bytesDownloaded: 100,
      playbackAvailable: false,
      source: { provider: "dispatcharr" as const, uuid: "11111111-1111-1111-1111-111111111111" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const acquisitions = {
      cacheAvailabilityFor: () => null,
      ensureCacheForPlay,
      get: () => undefined,
    };

    const dispatcharr = {
      resolveVodPlayback: true,
      findVodByTmdb: vi.fn(async () => ({
        identity,
        metadata: { title: "Fight Club", durationSeconds: 8400 },
        availability: [
          {
            provider: "dispatcharr" as const,
            available: true,
            canPlay: true,
            uuid: "11111111-1111-1111-1111-111111111111",
            movieId: 1,
            candidates: [{ streamId: "s1" }],
          },
        ],
        preferredAction: "PLAY_IPTV" as const,
      })),
    };

    const jellyfin = {
      findByTmdb: vi.fn(async () => null),
      resolvePlayback: vi.fn(async () => null),
    };

    const resolver = new PlaybackResolver(
      jellyfin as never,
      dispatcharr as never,
      undefined,
      acquisitions as never,
    );

    const result = await resolver.resolve({} as never, identity);
    expect(result).toEqual({ status: "buffering", acquisitionId: "acq-1" });
    expect(ensureCacheForPlay).toHaveBeenCalledOnce();
  });

  it("returns ready without subtitle tracks; listSubtitles enriches later", async () => {
    const acquisitions = {
      cacheAvailabilityFor: () => ({
        provider: "cache" as const,
        available: true,
        acquisitionId: "acq-fast",
        bytesDownloaded: 5_000_000,
        totalBytes: 10_000_000,
        playbackAvailable: true,
        complete: false,
      }),
      ensureCacheForPlay: vi.fn(),
      get: () => ({
        id: "acq-fast",
        mode: "cache",
        cacheExpiresAt: "2099-01-01T00:00:00.000Z",
      }),
    };

    const jellyfin = {
      findByTmdb: vi.fn(async () => null),
      resolvePlayback: vi.fn(async () => null as PlaybackSource | null),
    };

    const bazarr = {
      isConfigured: () => true,
      listSubtitles: vi.fn(async () => [
        {
          index: 0,
          language: "en",
          label: "English",
          url: "/api/playback/bazarr/subtitle/1",
        },
      ]),
    };

    const resolver = new PlaybackResolver(
      jellyfin as never,
      { resolveVodPlayback: true } as never,
      undefined,
      acquisitions as never,
      undefined,
      bazarr as never,
    );

    const result = await resolver.resolve({} as never, identity);
    expect(result?.status).toBe("ready");
    if (result?.status === "ready") {
      expect(result.source.subtitles).toBeUndefined();
    }

    const tracks = await resolver.listSubtitles({} as never, identity, {
      provider: "cache",
    });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.url).toContain("bazarr");
    expect(bazarr.listSubtitles).toHaveBeenCalledOnce();
  });

  it("returns ready cache source when playbackAvailable", async () => {
    const cacheSourceBits = {
      acquisitionId: "acq-2",
      bytesDownloaded: 5_000_000,
      totalBytes: 10_000_000,
      playbackAvailable: true,
      complete: false,
    };

    const acquisitions = {
      cacheAvailabilityFor: () => ({
        provider: "cache" as const,
        available: true,
        ...cacheSourceBits,
      }),
      ensureCacheForPlay: vi.fn(),
      get: () => ({
        id: "acq-2",
        mode: "cache",
        cacheExpiresAt: "2099-01-01T00:00:00.000Z",
      }),
    };

    const jellyfin = {
      findByTmdb: vi.fn(async () => null),
      resolvePlayback: vi.fn(async () => null as PlaybackSource | null),
    };

    const resolver = new PlaybackResolver(
      jellyfin as never,
      { resolveVodPlayback: true } as never,
      undefined,
      acquisitions as never,
    );

    const result = await resolver.resolve({} as never, identity);
    expect(result?.status).toBe("ready");
    if (result?.status === "ready") {
      expect(result.source.provider).toBe("cache");
      expect(result.source.delivery.url).toContain("/playback/cache/acq-2/hls/index.m3u8");
      expect(result.source.hls).toBe(true);
      expect(result.source.downloadComplete).toBe(false);
    }
    expect(acquisitions.ensureCacheForPlay).not.toHaveBeenCalled();
  });

  it("does not start IPTV when the series is already in the Jellyfin library", async () => {
    const ensureCacheForPlay = vi.fn();
    const acquisitions = {
      cacheAvailabilityFor: () => null,
      ensureCacheForPlay,
      get: () => undefined,
    };

    const jellyfin = {
      findByTmdb: vi.fn(async () => ({
        identity: { tmdbId: 62560, mediaType: "tv" as const, jellyfinItemId: "series-1" },
        metadata: { title: "Mr. Robot" },
        availability: [
          { provider: "jellyfin" as const, available: true, canPlay: false, itemId: "series-1" },
        ],
        preferredAction: "NONE" as const,
      })),
      listEpisodesForSeries: vi.fn(async () => [
        {
          identity: {
            tmdbId: 62560,
            mediaType: "episode" as const,
            jellyfinItemId: "ep-s4e1",
            seasonNumber: 4,
            episodeNumber: 1,
          },
          metadata: { title: "eps4.0" },
          availability: [
            {
              provider: "jellyfin" as const,
              available: true,
              canPlay: true,
              itemId: "ep-s4e1",
            },
          ],
          preferredAction: "PLAY_JELLYFIN" as const,
        },
      ]),
      resolvePlayback: vi.fn(async () => ({
        provider: "jellyfin" as const,
        delivery: { mode: "proxy" as const, url: "/api/playback/jellyfin/ep-s4e1" },
        directPlay: true,
      })),
    };

    const dispatcharr = {
      resolveVodPlayback: true,
      findVodByTmdb: vi.fn(),
    };

    const resolver = new PlaybackResolver(
      jellyfin as never,
      dispatcharr as never,
      undefined,
      acquisitions as never,
    );

    const result = await resolver.resolve({} as never, {
      tmdbId: 62560,
      mediaType: "episode",
      seasonNumber: 4,
      episodeNumber: 1,
    });

    expect(result?.status).toBe("ready");
    if (result?.status === "ready") {
      expect(result.source.provider).toBe("jellyfin");
    }
    expect(ensureCacheForPlay).not.toHaveBeenCalled();
    expect(dispatcharr.findVodByTmdb).not.toHaveBeenCalled();
  });

  it("skips IPTV for a missing episode when the series is in Jellyfin", async () => {
    const ensureCacheForPlay = vi.fn();
    const acquisitions = {
      cacheAvailabilityFor: () => null,
      ensureCacheForPlay,
      get: () => undefined,
    };

    const jellyfin = {
      findByTmdb: vi.fn(async () => ({
        identity: { tmdbId: 62560, mediaType: "tv" as const, jellyfinItemId: "series-1" },
        metadata: { title: "Mr. Robot" },
        availability: [],
        preferredAction: "NONE" as const,
      })),
      listEpisodesForSeries: vi.fn(async () => []),
      resolvePlayback: vi.fn(),
    };

    const dispatcharr = {
      resolveVodPlayback: true,
      findVodByTmdb: vi.fn(async () => ({
        identity: { tmdbId: 62560, mediaType: "episode" as const, seasonNumber: 99, episodeNumber: 1 },
        metadata: { title: "Ghost" },
        availability: [
          {
            provider: "dispatcharr" as const,
            available: true,
            canPlay: true,
            uuid: "iptv-ep",
            candidates: [],
          },
        ],
        preferredAction: "PLAY_IPTV" as const,
      })),
    };

    const resolver = new PlaybackResolver(
      jellyfin as never,
      dispatcharr as never,
      undefined,
      acquisitions as never,
    );

    const result = await resolver.resolve({} as never, {
      tmdbId: 62560,
      mediaType: "episode",
      seasonNumber: 99,
      episodeNumber: 1,
    });

    expect(result).toBeNull();
    expect(ensureCacheForPlay).not.toHaveBeenCalled();
    expect(dispatcharr.findVodByTmdb).not.toHaveBeenCalled();
  });
});
