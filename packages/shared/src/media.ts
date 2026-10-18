import { z } from "zod";
import { MediaIdentitySchema } from "./identity.js";

export const CreditPersonSchema = z.object({
  tmdbId: z.number().int().optional(),
  name: z.string(),
  /** Character name for cast, or crew job (Director, Writer, …). */
  role: z.string().optional(),
  profileUrl: z.string().optional(),
});
export type CreditPerson = z.infer<typeof CreditPersonSchema>;

export const MediaMetadataSchema = z.object({
  title: z.string(),
  originalTitle: z.string().optional(),
  year: z.number().int().optional(),
  overview: z.string().optional(),
  tagline: z.string().optional(),
  posterUrl: z.string().optional(),
  backdropUrl: z.string().optional(),
  runtimeMinutes: z.number().optional(),
  /** Exact runtime in seconds when known (preferred over runtimeMinutes * 60). */
  durationSeconds: z.number().nonnegative().optional(),
  /** Episode still (TMDb) when this row is an episode. */
  stillUrl: z.string().optional(),
  airDate: z.string().optional(),
  genres: z.array(z.string()).optional(),
  /** TMDb series status, e.g. "Returning Series". */
  seriesStatus: z.string().optional(),
  /** Studios / production companies (and TV networks). */
  studios: z.array(z.string()).optional(),
  /** Keywords / moods (Netflix “This show is”). */
  keywords: z.array(z.string()).optional(),
  /** Top-billed cast with optional portraits. */
  cast: z.array(CreditPersonSchema).optional(),
  /** Directors (movies) or creators (series). */
  creators: z.array(CreditPersonSchema).optional(),
  /** Writers / screenplay credits. */
  writers: z.array(CreditPersonSchema).optional(),
  /**
   * YouTube trailer watch URL when Seerr/TMDb exposes a Trailer video
   * (e.g. https://www.youtube.com/watch?v=…).
   */
  trailerUrl: z.string().url().optional(),
  /** YouTube video id for embedding muted billboard previews. */
  trailerYoutubeKey: z.string().optional(),
});
export type MediaMetadata = z.infer<typeof MediaMetadataSchema>;

export const JellyfinAvailabilitySchema = z.object({
  provider: z.literal("jellyfin"),
  available: z.boolean(),
  itemId: z.string().optional(),
  qualityLabel: z.string().optional(),
  canPlay: z.boolean(),
  positionSeconds: z.number().optional(),
  durationSeconds: z.number().optional(),
  /** ISO timestamp from Jellyfin UserData.LastPlayedDate when known. */
  lastPlayedAt: z.string().optional(),
});
export type JellyfinAvailability = z.infer<typeof JellyfinAvailabilitySchema>;

export const CacheAvailabilitySchema = z.object({
  provider: z.literal("cache"),
  available: z.boolean(),
  acquisitionId: z.string().optional(),
  localPath: z.string().optional(),
  bytesDownloaded: z.number().optional(),
  totalBytes: z.number().optional(),
  playbackAvailable: z.boolean(),
  complete: z.boolean(),
});
export type CacheAvailability = z.infer<typeof CacheAvailabilitySchema>;

export const DispatcharrStreamCandidateSchema = z.object({
  streamId: z.string().optional(),
  m3uAccountId: z.number().optional(),
  /** Usually provider category name (e.g. "EN - DRAMA") — used for language ranking. */
  label: z.string().optional(),
  /** Catalogue/audio language inferred from category / title prefix (en, it, …). */
  catalogueLanguage: z.string().optional(),
  /** Raw quality_info.quality when present (often "4K"). */
  qualityLabel: z.string().optional(),
  /** Approximate vertical resolution (2160 for 4K). */
  resolutionHeight: z.number().int().positive().optional(),
  hdr: z.boolean().optional(),
});
export type DispatcharrStreamCandidate = z.infer<typeof DispatcharrStreamCandidateSchema>;

export const DispatcharrAvailabilitySchema = z.object({
  provider: z.literal("dispatcharr"),
  available: z.boolean(),
  movieId: z.number().optional(),
  seriesId: z.number().optional(),
  episodeId: z.number().optional(),
  uuid: z.string().optional(),
  tmdbId: z.string().optional(),
  imdbId: z.string().optional(),
  /** Language inferred from IPTV catalogue title prefix (en, it, …). */
  catalogueLanguage: z.string().optional(),
  candidates: z.array(DispatcharrStreamCandidateSchema).default([]),
  canPlay: z.boolean(),
});
export type DispatcharrAvailability = z.infer<typeof DispatcharrAvailabilitySchema>;

export const RequestAvailabilitySchema = z.object({
  provider: z.literal("seerr"),
  requestable: z.boolean(),
  requestStatus: z.string().optional(),
  mediaStatus: z.string().optional(),
});
export type RequestAvailability = z.infer<typeof RequestAvailabilitySchema>;

export const AvailabilitySchema = z.discriminatedUnion("provider", [
  JellyfinAvailabilitySchema,
  CacheAvailabilitySchema,
  DispatcharrAvailabilitySchema,
  RequestAvailabilitySchema,
]);
export type Availability = z.infer<typeof AvailabilitySchema>;

export const PreferredActionSchema = z.enum([
  "PLAY_JELLYFIN",
  "PLAY_CACHE",
  "PLAY_IPTV",
  "REQUEST",
  "NONE",
]);
export type PreferredAction = z.infer<typeof PreferredActionSchema>;

export const MediaSchema = z.object({
  identity: MediaIdentitySchema,
  metadata: MediaMetadataSchema,
  availability: z.array(AvailabilitySchema),
  preferredAction: PreferredActionSchema,
});
export type Media = z.infer<typeof MediaSchema>;
