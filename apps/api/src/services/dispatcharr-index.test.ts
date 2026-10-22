import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { lookupDispatcharrIndex, rememberDispatcharrMedia } from "./dispatcharr-index.js";

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
      language_confidence TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tmdb_id, media_type)
    );
  `);
  return drizzle(sqlite, { schema });
}

describe("lookupDispatcharrIndex", () => {
  it("purges a NULL-language row that was never corroborated", () => {
    const db = makeDb();
    db.insert(schema.dispatcharrTmdbIndex)
      .values({
        tmdbId: 550,
        mediaType: "movie",
        dispatcharrId: 1,
        uuid: "untagged",
        streamId: null,
        title: "NF - Fight Club",
        catalogueLanguage: null,
        languageConfidence: null,
        updatedAt: new Date(),
      })
      .run();

    expect(lookupDispatcharrIndex(db, 550, "movie", ["en"])).toBeNull();
    expect(db.select().from(schema.dispatcharrTmdbIndex).all()).toHaveLength(0);
  });

  it("keeps a corroborated untagged row", () => {
    const db = makeDb();
    db.insert(schema.dispatcharrTmdbIndex)
      .values({
        tmdbId: 550,
        mediaType: "movie",
        dispatcharrId: 1,
        uuid: "untagged",
        streamId: null,
        title: "NF - Fight Club",
        catalogueLanguage: "en",
        languageConfidence: "corroborated",
        updatedAt: new Date(),
      })
      .run();

    const hit = lookupDispatcharrIndex(db, 550, "movie", ["en"]);
    expect(hit?.uuid).toBe("untagged");
    expect(hit?.languageConfidence).toBe("corroborated");
  });

  it("purges an obvious language mismatch", () => {
    const db = makeDb();
    db.insert(schema.dispatcharrTmdbIndex)
      .values({
        tmdbId: 550,
        mediaType: "movie",
        dispatcharrId: 1,
        uuid: "de-copy",
        streamId: null,
        title: "DE - Fight Club",
        catalogueLanguage: "de",
        languageConfidence: "confirmed",
        updatedAt: new Date(),
      })
      .run();

    expect(lookupDispatcharrIndex(db, 550, "movie", ["en"])).toBeNull();
    expect(db.select().from(schema.dispatcharrTmdbIndex).all()).toHaveLength(0);
  });
});

describe("rememberDispatcharrMedia", () => {
  it("stores languageConfidence from the playable copy", () => {
    const db = makeDb();
    rememberDispatcharrMedia(db, {
      identity: { tmdbId: 550, mediaType: "movie" },
      metadata: { title: "EN - Fight Club" },
      availability: [
        {
          provider: "dispatcharr",
          available: true,
          canPlay: true,
          movieId: 99,
          uuid: "fight-club",
          catalogueLanguage: "en",
          languageConfidence: "confirmed",
          candidates: [],
        },
      ],
      preferredAction: "PLAY_IPTV",
    });

    const rows = db.select().from(schema.dispatcharrTmdbIndex).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.languageConfidence).toBe("confirmed");
    expect(rows[0]?.catalogueLanguage).toBe("en");
  });
});
