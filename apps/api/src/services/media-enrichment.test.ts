import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Media } from "@reclinarr/shared";
import * as schema from "../db/schema.js";
import {
  enrichDiscoveryRow,
  applyTmdbArtwork,
  clearTmdbArtworkCache,
  resolveMediaByTmdb,
  resolveMediaAvailabilityByTmdb,
} from "./media-enrichment.js";
import { applyCatalogWinners } from "./vod-catalog-sync.js";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE dispatcharr_tmdb_index (
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      dispatcharr_id INTEGER NOT NULL,
      uuid TEXT NOT NULL,
      stream_id TEXT,
      title TEXT,
      catalogue_language TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tmdb_id, media_type)
    );
  `);
  return drizzle(sqlite, { schema });
}

function seerrMovie(tmdbId: number, title: string): Media {
  return {
    identity: { tmdbId, mediaType: "movie" },
    metadata: { title },
    availability: [
      {
        provider: "seerr",
        requestable: true,
        mediaStatus: "UNKNOWN",
      },
    ],
    preferredAction: "REQUEST",
  };
}

function seerrSeries(tmdbId: number, title: string): Media {
  return {
    identity: { tmdbId, mediaType: "tv" },
    metadata: { title },
    availability: [
      {
        provider: "seerr",
        requestable: true,
        mediaStatus: "UNKNOWN",
      },
    ],
    preferredAction: "REQUEST",
  };
}

describe("resolveMediaByTmdb", () => {
  it("returns a fast shell with iptvResolvePending when the index misses", async () => {
    const db = makeDb();
    let searched = false;
    const ctx = {
      db,
      seerr: {
        getDetails: async () => seerrMovie(550, "Fight Club"),
      },
      jellyfin: {
        findByTmdb: async () => null,
      },
      dispatcharr: {
        getPreferredLanguages: () => ["en"],
        findVodByTmdb: async () => {
          searched = true;
          return null;
        },
      },
      acquisitions: { cacheAvailabilityFor: () => null },
    } as unknown as Parameters<typeof resolveMediaByTmdb>[0];

    const out = await resolveMediaByTmdb(ctx, {} as never, "movie", 550);
    expect(out?.media.metadata.title).toBe("Fight Club");
    expect(out?.iptvResolvePending).toBe(true);
    expect(searched).toBe(false);
  });

  it("attaches indexed Dispatcharr without live search", async () => {
    const db = makeDb();
    applyCatalogWinners(
      db,
      [
        {
          tmdbId: 550,
          mediaType: "movie",
          dispatcharrId: 99,
          uuid: "fight-club",
          title: "EN - Fight Club",
          catalogueLanguage: "en",
        },
      ],
      new Date(),
    );
    let searched = false;
    const ctx = {
      db,
      seerr: {
        getDetails: async () => seerrMovie(550, "Fight Club"),
      },
      jellyfin: {
        findByTmdb: async () => null,
      },
      dispatcharr: {
        getPreferredLanguages: () => ["en"],
        findVodByTmdb: async () => {
          searched = true;
          return null;
        },
      },
      acquisitions: { cacheAvailabilityFor: () => null },
    } as unknown as Parameters<typeof resolveMediaByTmdb>[0];

    const out = await resolveMediaByTmdb(ctx, {} as never, "movie", 550);
    expect(out?.iptvResolvePending).toBe(false);
    expect(out?.media.preferredAction).toBe("PLAY_IPTV");
    expect(searched).toBe(false);
  });

  it("availability path searches Dispatcharr and remembers hits", async () => {
    const db = makeDb();
    const ctx = {
      db,
      seerr: {
        getDetails: async () => seerrMovie(550, "Fight Club"),
      },
      jellyfin: {
        findByTmdb: async () => null,
      },
      dispatcharr: {
        getPreferredLanguages: () => ["en"],
        findVodByTmdb: async () => ({
          identity: { tmdbId: 550, mediaType: "movie" as const },
          metadata: { title: "EN - Fight Club" },
          availability: [
            {
              provider: "dispatcharr" as const,
              available: true,
              canPlay: true,
              movieId: 99,
              uuid: "fight-club",
              catalogueLanguage: "en",
            },
          ],
          preferredAction: "PLAY_IPTV" as const,
        }),
      },
      acquisitions: { cacheAvailabilityFor: () => null },
    } as unknown as Parameters<typeof resolveMediaAvailabilityByTmdb>[0];

    const out = await resolveMediaAvailabilityByTmdb(ctx, {} as never, "movie", 550);
    expect(out?.preferredAction).toBe("PLAY_IPTV");
    const indexed = db.select().from(schema.dispatcharrTmdbIndex).all();
    expect(indexed).toHaveLength(1);
    expect(indexed[0]?.uuid).toBe("fight-club");
  });
});

describe("enrichDiscoveryRow", () => {
  it("marks an indexed movie as PLAY_IPTV", () => {
    const db = makeDb();
    applyCatalogWinners(
      db,
      [
        {
          tmdbId: 550,
          mediaType: "movie",
          dispatcharrId: 99,
          uuid: "fight-club",
          title: "EN - Fight Club",
          catalogueLanguage: "en",
        },
      ],
      new Date(),
    );

    const ctx = {
      db,
      dispatcharr: { getPreferredLanguages: () => ["en"] },
    } as unknown as Parameters<typeof enrichDiscoveryRow>[0];

    const [out] = enrichDiscoveryRow(ctx, [seerrMovie(550, "Fight Club")]);
    expect(out?.preferredAction).toBe("PLAY_IPTV");
    expect(out?.availability.some((a) => a.provider === "dispatcharr" && a.canPlay)).toBe(
      true,
    );
  });

  it("keeps a Seerr-only title as REQUEST (Download on the card)", () => {
    const db = makeDb();
    const ctx = {
      db,
      dispatcharr: { getPreferredLanguages: () => ["en"] },
    } as unknown as Parameters<typeof enrichDiscoveryRow>[0];

    const [out] = enrichDiscoveryRow(ctx, [seerrMovie(999, "Missing On Iptv")]);
    expect(out?.preferredAction).toBe("REQUEST");
    expect(out?.availability.some((a) => a.provider === "dispatcharr")).toBe(false);
  });

  it("marks indexed series available without canPlay so the card opens details", () => {
    const db = makeDb();
    applyCatalogWinners(
      db,
      [
        {
          tmdbId: 1396,
          mediaType: "tv",
          dispatcharrId: 7,
          uuid: "breaking-bad",
          title: "EN - Breaking Bad",
          catalogueLanguage: "en",
        },
      ],
      new Date(),
    );

    const ctx = {
      db,
      dispatcharr: { getPreferredLanguages: () => ["en"] },
    } as unknown as Parameters<typeof enrichDiscoveryRow>[0];

    const [out] = enrichDiscoveryRow(ctx, [seerrSeries(1396, "Breaking Bad")]);
    const da = out?.availability.find((a) => a.provider === "dispatcharr");
    expect(da?.available).toBe(true);
    expect(da && "canPlay" in da ? da.canPlay : undefined).toBe(false);
    // Not PLAY_IPTV — episode-level play only.
    expect(out?.preferredAction).toBe("REQUEST");
  });

  it("prefers library membership over IPTV when libraryKeys is set", () => {
    const db = makeDb();
    applyCatalogWinners(
      db,
      [
        {
          tmdbId: 550,
          mediaType: "movie",
          dispatcharrId: 99,
          uuid: "fight-club",
          title: "EN - Fight Club",
          catalogueLanguage: "en",
        },
      ],
      new Date(),
    );

    const ctx = {
      db,
      dispatcharr: { getPreferredLanguages: () => ["en"] },
    } as unknown as Parameters<typeof enrichDiscoveryRow>[0];

    const [out] = enrichDiscoveryRow(ctx, [seerrMovie(550, "Fight Club")], {
      libraryKeys: new Set(["movie:550"]),
    });
    expect(out?.preferredAction).toBe("PLAY_JELLYFIN");
  });
});

describe("applyTmdbArtwork", () => {
  it("replaces Jellyfin proxy posters with TMDb CDN URLs", async () => {
    clearTmdbArtworkCache();
    const ctx = {
      seerr: {
        getDetails: async (mediaType: "movie" | "tv", tmdbId: number) => ({
          identity: { tmdbId, mediaType },
          metadata: {
            title: "Fight Club",
            posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
            backdropUrl: "https://image.tmdb.org/t/p/w1280/back.jpg",
          },
          availability: [],
          preferredAction: "NONE" as const,
        }),
      },
      jellyfin: {},
      db: makeDb(),
      dispatcharr: {},
    } as unknown as Parameters<typeof applyTmdbArtwork>[0];

    const item: Media = {
      identity: { tmdbId: 550, mediaType: "movie", jellyfinItemId: "jf-1" },
      metadata: {
        title: "Fight Club",
        posterUrl: "https://reclinarr.example/api/images/jellyfin/jf-1/Primary",
        backdropUrl: "https://reclinarr.example/api/images/jellyfin/jf-1/Backdrop",
      },
      availability: [{ provider: "jellyfin", available: true, canPlay: true, itemId: "jf-1" }],
      preferredAction: "PLAY_JELLYFIN",
    };

    const [out] = await applyTmdbArtwork(ctx, [item]);
    expect(out?.metadata.posterUrl).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
    expect(out?.metadata.backdropUrl).toBe("https://image.tmdb.org/t/p/w1280/back.jpg");
  });

  it("uses series TMDb art for episodes via jellyfinSeriesId", async () => {
    clearTmdbArtworkCache();
    const ctx = {
      seerr: {
        getDetails: async (mediaType: "movie" | "tv", tmdbId: number) => ({
          identity: { tmdbId, mediaType },
          metadata: {
            title: "Mr. Robot",
            posterUrl: "https://image.tmdb.org/t/p/w500/robot.jpg",
            backdropUrl: "https://image.tmdb.org/t/p/w1280/robot-back.jpg",
          },
          availability: [],
          preferredAction: "NONE" as const,
        }),
      },
      jellyfin: {
        getByJellyfinItemId: async () => ({
          identity: { tmdbId: 62560, mediaType: "tv", jellyfinItemId: "series-1" },
          metadata: { title: "Mr. Robot" },
          availability: [],
          preferredAction: "PLAY_JELLYFIN" as const,
        }),
      },
      db: makeDb(),
      dispatcharr: {},
    } as unknown as Parameters<typeof applyTmdbArtwork>[0];

    const item: Media = {
      identity: {
        tmdbId: 999,
        mediaType: "episode",
        jellyfinItemId: "ep-1",
        jellyfinSeriesId: "series-1",
        seasonNumber: 1,
        episodeNumber: 1,
      },
      metadata: {
        title: "Mr. Robot S1E1",
        posterUrl: "https://reclinarr.example/api/images/jellyfin/ep-1/Primary",
      },
      availability: [{ provider: "jellyfin", available: true, canPlay: true, itemId: "ep-1" }],
      preferredAction: "PLAY_JELLYFIN",
    };

    const user = {
      jellyfinUserId: "u",
      jellyfinAccessToken: "t",
      deviceId: "d",
      deviceName: "test",
    };
    const [out] = await applyTmdbArtwork(ctx, [item], user);
    expect(out?.metadata.posterUrl).toBe("https://image.tmdb.org/t/p/w500/robot.jpg");
  });
});

describe("applyTmdbArtwork", () => {
  it("replaces Jellyfin proxy posters with TMDb CDN URLs from Seerr", async () => {
    const { applyTmdbArtwork, clearTmdbArtworkCache } = await import("./media-enrichment.js");
    clearTmdbArtworkCache();

    const jellyfinItem: Media = {
      identity: { jellyfinItemId: "jf-1", tmdbId: 1396, mediaType: "tv" },
      metadata: {
        title: "Breaking Bad",
        posterUrl: "https://reclinarr.example/api/images/jellyfin/jf-1/Primary",
        backdropUrl: "https://reclinarr.example/api/images/jellyfin/jf-1/Backdrop",
      },
      availability: [{ provider: "jellyfin", available: true, canPlay: true, itemId: "jf-1" }],
      preferredAction: "PLAY_JELLYFIN",
    };

    const ctx = {
      seerr: {
        getDetails: async () => ({
          identity: { tmdbId: 1396, mediaType: "tv" as const },
          metadata: {
            title: "Breaking Bad",
            posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
            backdropUrl: "https://image.tmdb.org/t/p/w1280/back.jpg",
          },
          availability: [],
          preferredAction: "REQUEST" as const,
        }),
      },
      jellyfin: {},
      db: makeDb(),
    } as unknown as Parameters<typeof applyTmdbArtwork>[0];

    const [out] = await applyTmdbArtwork(ctx, [jellyfinItem]);
    expect(out?.metadata.posterUrl).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
    expect(out?.metadata.backdropUrl).toBe("https://image.tmdb.org/t/p/w1280/back.jpg");
  });

  it("uses series TMDb art for episodes via jellyfinSeriesId", async () => {
    const { applyTmdbArtwork, clearTmdbArtworkCache } = await import("./media-enrichment.js");
    clearTmdbArtworkCache();

    const episode: Media = {
      identity: {
        jellyfinItemId: "ep-1",
        jellyfinSeriesId: "series-1",
        mediaType: "episode",
        seasonNumber: 1,
        episodeNumber: 1,
      },
      metadata: {
        title: "Breaking Bad S1E1",
        posterUrl: "https://reclinarr.example/api/images/jellyfin/ep-1/Primary",
      },
      availability: [{ provider: "jellyfin", available: true, canPlay: true, itemId: "ep-1" }],
      preferredAction: "PLAY_JELLYFIN",
    };

    const ctx = {
      seerr: {
        getDetails: async (_type: "movie" | "tv", tmdbId: number) => ({
          identity: { tmdbId, mediaType: "tv" as const },
          metadata: {
            title: "Breaking Bad",
            posterUrl: "https://image.tmdb.org/t/p/w500/series.jpg",
            backdropUrl: "https://image.tmdb.org/t/p/w1280/series-back.jpg",
          },
          availability: [],
          preferredAction: "REQUEST" as const,
        }),
      },
      jellyfin: {
        getByJellyfinItemId: async () => ({
          identity: { jellyfinItemId: "series-1", tmdbId: 1396, mediaType: "tv" as const },
          metadata: { title: "Breaking Bad" },
          availability: [],
          preferredAction: "PLAY_JELLYFIN" as const,
        }),
      },
      db: makeDb(),
    } as unknown as Parameters<typeof applyTmdbArtwork>[0];

    const user = {
      jellyfinUserId: "u",
      jellyfinAccessToken: "t",
      deviceId: "d",
      deviceName: "test",
    };

    const [out] = await applyTmdbArtwork(ctx, [episode], user);
    expect(out?.metadata.posterUrl).toBe("https://image.tmdb.org/t/p/w500/series.jpg");
  });
});
