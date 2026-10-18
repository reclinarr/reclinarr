import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import type { Media } from "@reclinarr/shared";
import {
  applyCatalogWinners,
  collectHotVodTargets,
  pickCatalogWinners,
  type VodCatalogCandidate,
} from "./vod-catalog-sync.js";

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

describe("pickCatalogWinners", () => {
  it("skips nothing when TMDb is present and picks preferred language", () => {
    const candidates: VodCatalogCandidate[] = [
      {
        dispatcharrId: 1,
        uuid: "a",
        name: "DE - Zootopia",
        tmdbId: 269149,
        mediaType: "movie",
      },
      {
        dispatcharrId: 2,
        uuid: "b",
        name: "EN - Zootopia",
        tmdbId: 269149,
        mediaType: "movie",
      },
      {
        dispatcharrId: 3,
        uuid: "c",
        name: "IT - Zootopia",
        tmdbId: 269149,
        mediaType: "movie",
      },
    ];
    const winners = pickCatalogWinners(candidates, ["en"]);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.dispatcharrId).toBe(2);
    expect(winners[0]?.catalogueLanguage).toBe("en");
  });

  it("keeps movie and series for the same TMDb id separate", () => {
    const candidates: VodCatalogCandidate[] = [
      {
        dispatcharrId: 10,
        uuid: "m",
        name: "EN - Same",
        tmdbId: 100,
        mediaType: "movie",
      },
      {
        dispatcharrId: 11,
        uuid: "s",
        name: "EN - Same",
        tmdbId: 100,
        mediaType: "tv",
      },
    ];
    const winners = pickCatalogWinners(candidates, ["en"]);
    expect(winners).toHaveLength(2);
    expect(winners.map((w) => w.mediaType).sort()).toEqual(["movie", "tv"]);
  });

  it("prefers it then en when configured", () => {
    const candidates: VodCatalogCandidate[] = [
      {
        dispatcharrId: 1,
        uuid: "en",
        name: "EN - Title",
        tmdbId: 1,
        mediaType: "movie",
      },
      {
        dispatcharrId: 2,
        uuid: "it",
        name: "IT - Title",
        tmdbId: 1,
        mediaType: "movie",
      },
    ];
    const winners = pickCatalogWinners(candidates, ["it", "en"]);
    expect(winners[0]?.uuid).toBe("it");
  });
});

describe("applyCatalogWinners", () => {
  it("upserts winners without pruning by default (hot warm)", () => {
    const db = makeDb();
    const t0 = new Date("2020-01-01T00:00:00Z");
    applyCatalogWinners(
      db,
      [
        {
          tmdbId: 1,
          mediaType: "movie",
          dispatcharrId: 1,
          uuid: "old",
          title: "Old",
          catalogueLanguage: "en",
        },
      ],
      t0,
    );

    const t1 = new Date("2020-01-02T00:00:00Z");
    const result = applyCatalogWinners(
      db,
      [
        {
          tmdbId: 2,
          mediaType: "movie",
          dispatcharrId: 22,
          uuid: "keep-new",
          title: "Keep Updated",
          catalogueLanguage: "en",
        },
      ],
      t1,
    );

    expect(result.upserted).toBe(1);
    expect(result.removed).toBe(0);
    const rows = db.select().from(schema.dispatcharrTmdbIndex).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.tmdbId === 1)?.uuid).toBe("old");
  });

  it("removes stale rows when pruneStale is true", () => {
    const db = makeDb();
    const t0 = new Date("2020-01-01T00:00:00Z");
    applyCatalogWinners(
      db,
      [
        {
          tmdbId: 1,
          mediaType: "movie",
          dispatcharrId: 1,
          uuid: "old",
          title: "Old",
          catalogueLanguage: "en",
        },
        {
          tmdbId: 2,
          mediaType: "movie",
          dispatcharrId: 2,
          uuid: "keep-old",
          title: "Keep",
          catalogueLanguage: "en",
        },
      ],
      t0,
      { pruneStale: true },
    );

    const t1 = new Date("2020-01-02T00:00:00Z");
    const result = applyCatalogWinners(
      db,
      [
        {
          tmdbId: 2,
          mediaType: "movie",
          dispatcharrId: 22,
          uuid: "keep-new",
          title: "Keep Updated",
          catalogueLanguage: "en",
        },
        {
          tmdbId: 3,
          mediaType: "tv",
          dispatcharrId: 3,
          uuid: "new",
          title: "New Show",
          catalogueLanguage: "en",
        },
      ],
      t1,
      { pruneStale: true },
    );

    expect(result.upserted).toBe(2);
    expect(result.removed).toBe(1);

    const rows = db.select().from(schema.dispatcharrTmdbIndex).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.tmdbId === 1)).toBeUndefined();
    expect(rows.find((r) => r.tmdbId === 2)?.uuid).toBe("keep-new");
    expect(rows.find((r) => r.tmdbId === 3)?.mediaType).toBe("tv");
  });
});

describe("collectHotVodTargets", () => {
  it("dedupes Seerr home and catalog rails by mediaType:tmdbId", async () => {
    const movie = (tmdbId: number, title: string): Media => ({
      identity: { tmdbId, mediaType: "movie" },
      metadata: { title, year: 2020 },
      availability: [],
      preferredAction: "REQUEST",
    });
    const seerr = {
      discoverTrending: async () => [movie(1, "One"), movie(2, "Two")],
      discoverMovies: async () => [movie(1, "One again"), movie(3, "Three")],
      discoverTv: async () =>
        [
          {
            identity: { tmdbId: 10, mediaType: "tv" as const },
            metadata: { title: "Show", year: 2021 },
            availability: [],
            preferredAction: "REQUEST" as const,
          },
        ] satisfies Media[],
    };

    const targets = await collectHotVodTargets(seerr as never);
    const keys = targets.map((t) => `${t.mediaType}:${t.tmdbId}`).sort();
    expect(keys).toEqual(["movie:1", "movie:2", "movie:3", "tv:10"]);
    expect(targets.find((t) => t.tmdbId === 1)?.titleHint).toBe("One");
  });
});
