import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as schema from "./schema.js";

export function createDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "streamerr.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      jellyfin_user_id TEXT NOT NULL,
      jellyfin_username TEXT NOT NULL,
      jellyfin_access_token TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playback_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tmdb_id INTEGER,
      media_type TEXT NOT NULL,
      season_number INTEGER,
      episode_number INTEGER,
      provider TEXT NOT NULL,
      position_seconds INTEGER NOT NULL,
      duration_seconds INTEGER,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jellyfin_tmdb_index (
      jellyfin_item_id TEXT PRIMARY KEY,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS acquisitions (
      id TEXT PRIMARY KEY,
      tmdb_id INTEGER,
      media_type TEXT NOT NULL,
      mode TEXT NOT NULL,
      state TEXT NOT NULL,
      bytes_downloaded INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER,
      local_path TEXT,
      playback_available INTEGER NOT NULL DEFAULT 0,
      source_json TEXT NOT NULL,
      identity_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dispatcharr_tmdb_index (
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
  // Additive columns for older DBs
  try {
    sqlite.exec(`ALTER TABLE playback_progress ADD COLUMN title TEXT`);
  } catch {
    /* already exists */
  }
  try {
    sqlite.exec(`ALTER TABLE playback_progress ADD COLUMN poster_url TEXT`);
  } catch {
    /* already exists */
  }
  try {
    sqlite.exec(`ALTER TABLE dispatcharr_tmdb_index ADD COLUMN catalogue_language TEXT`);
  } catch {
    /* already exists */
  }
  return drizzle(sqlite, { schema });
}

export type AppDb = ReturnType<typeof createDb>;
