import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  jellyfinUserId: text("jellyfin_user_id").notNull(),
  jellyfinUsername: text("jellyfin_username").notNull(),
  jellyfinAccessToken: text("jellyfin_access_token").notNull(),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const playbackProgress = sqliteTable("playback_progress", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tmdbId: integer("tmdb_id"),
  mediaType: text("media_type").notNull(),
  seasonNumber: integer("season_number"),
  episodeNumber: integer("episode_number"),
  provider: text("provider").notNull(),
  positionSeconds: integer("position_seconds").notNull(),
  durationSeconds: integer("duration_seconds"),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  title: text("title"),
  posterUrl: text("poster_url"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const jellyfinTmdbIndex = sqliteTable("jellyfin_tmdb_index", {
  jellyfinItemId: text("jellyfin_item_id").primaryKey(),
  tmdbId: integer("tmdb_id").notNull(),
  mediaType: text("media_type").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const acquisitions = sqliteTable("acquisitions", {
  id: text("id").primaryKey(),
  tmdbId: integer("tmdb_id"),
  mediaType: text("media_type").notNull(),
  mode: text("mode").notNull(),
  state: text("state").notNull(),
  bytesDownloaded: integer("bytes_downloaded").notNull().default(0),
  totalBytes: integer("total_bytes"),
  localPath: text("local_path"),
  playbackAvailable: integer("playback_available", { mode: "boolean" }).notNull().default(false),
  sourceJson: text("source_json").notNull(),
  identityJson: text("identity_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Cache Dispatcharr uuid lookups — catalogues can be 70k+ rows. */
export const dispatcharrTmdbIndex = sqliteTable(
  "dispatcharr_tmdb_index",
  {
    tmdbId: integer("tmdb_id").notNull(),
    mediaType: text("media_type").notNull(),
    dispatcharrId: integer("dispatcharr_id").notNull(),
    uuid: text("uuid").notNull(),
    streamId: text("stream_id"),
    title: text("title"),
    /** Catalogue language of the ranked pick (en, it, …). */
    catalogueLanguage: text("catalogue_language"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tmdbId, t.mediaType] })],
);
