import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Media } from "@reclinarr/shared";
import * as schema from "../db/schema.js";
import { IptvProgressStore } from "./iptv-progress.js";
import { continueSeriesKey, hydrateContinueWatching } from "./home-continue.js";

describe("Continue Watching identities", () => {
  it("recovers Jellyfin IDs from progress written before TMDb identity was known", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE playback_progress (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tmdb_id INTEGER,
      media_type TEXT NOT NULL, season_number INTEGER, episode_number INTEGER,
      provider TEXT NOT NULL, position_seconds INTEGER NOT NULL, duration_seconds INTEGER,
      completed INTEGER NOT NULL DEFAULT 0, title TEXT, poster_url TEXT, updated_at INTEGER NOT NULL
    )`);
    const store = new IptvProgressStore(drizzle(sqlite, { schema }));
    store.upsert("viewer", {
      identity: { mediaType: "episode", jellyfinItemId: "episode-1", seasonNumber: 4, episodeNumber: 1 },
      provider: "jellyfin", positionSeconds: 120, title: "Series S4E1",
    });
    expect(store.listContinue("viewer")[0]?.identity.jellyfinItemId).toBe("episode-1");
    expect(store.listContinue("other")).toEqual([]);
    sqlite.close();
  });

  it("restores series identity and artwork while preserving local watch progress", async () => {
    const episode: Media = {
      identity: { mediaType: "episode", jellyfinItemId: "episode-1", seasonNumber: 4, episodeNumber: 1 },
      metadata: { title: "Series S4E1" },
      availability: [{ provider: "jellyfin", available: true, canPlay: true, positionSeconds: 120 }],
      preferredAction: "PLAY_JELLYFIN",
    };
    const library: Media = {
      ...episode,
      identity: { ...episode.identity, jellyfinSeriesId: "series-1" },
      availability: [{ provider: "jellyfin", available: true, canPlay: true, itemId: "episode-1", positionSeconds: 0 }],
    };
    const series: Media = {
      identity: { mediaType: "tv", jellyfinItemId: "series-1", tmdbId: 42 },
      metadata: { title: "Series", backdropUrl: "/series.jpg" }, availability: [], preferredAction: "NONE",
    };
    const getByJellyfinItemId = vi.fn(async (_user: unknown, id: string) => id === "series-1" ? series : library);
    const hydrated = await hydrateContinueWatching({ jellyfin: { getByJellyfinItemId } } as never, {} as never, [episode]);
    expect(hydrated[0]?.identity).toMatchObject({ jellyfinItemId: "episode-1", jellyfinSeriesId: "series-1", tmdbId: 42 });
    expect(hydrated[0]?.metadata.backdropUrl).toBe("/series.jpg");
    expect(hydrated[0]?.availability[0]).toMatchObject({ itemId: "episode-1", positionSeconds: 120 });
    expect(continueSeriesKey(hydrated[0]!)).toBe(continueSeriesKey({ ...episode, identity: { ...episode.identity, tmdbId: 42 } }));
  });
});
