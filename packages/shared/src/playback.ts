import { z } from "zod";
import { MediaIdentitySchema } from "./identity.js";

export const PlaybackDeliverySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("direct"),
    url: z.string(),
    headers: z.record(z.string()).optional(),
  }),
  z.object({
    mode: z.literal("proxy"),
    url: z.string(),
  }),
]);
export type PlaybackDelivery = z.infer<typeof PlaybackDeliverySchema>;

export const SubtitleTrackSchema = z.object({
  index: z.number(),
  language: z.string().optional(),
  label: z.string().optional(),
  url: z.string().optional(),
  forced: z.boolean().optional(),
  hearingImpaired: z.boolean().optional(),
});
export type SubtitleTrack = z.infer<typeof SubtitleTrackSchema>;

export const AudioTrackSchema = z.object({
  index: z.number(),
  language: z.string().optional(),
  label: z.string().optional(),
});
export type AudioTrack = z.infer<typeof AudioTrackSchema>;

export const PlaybackSourceSchema = z.object({
  resolvedIdentity: MediaIdentitySchema.optional(),
  provider: z.enum(["jellyfin", "cache", "dispatcharr"]),
  delivery: PlaybackDeliverySchema,
  directPlay: z.boolean(),
  /** How Jellyfin will deliver media to the browser-compatible profile. */
  playMethod: z.enum(["DirectPlay", "DirectStream", "Transcode"]).optional(),
  /** True when the delivery URL is an HLS playlist (m3u8). */
  hls: z.boolean().optional(),
  mimeType: z.string().optional(),
  playSessionId: z.string().optional(),
  mediaSourceId: z.string().optional(),
  itemId: z.string().optional(),
  startPositionSeconds: z.number().optional(),
  /**
   * Known runtime from catalogue metadata. Used when progressive remux
   * (fMP4) reports Infinity/unknown duration to the browser.
   */
  durationSeconds: z.number().nonnegative().optional(),
  /** Cache acquisition id when playing from a local download. */
  acquisitionId: z.string().optional(),
  bytesDownloaded: z.number().nonnegative().optional(),
  totalBytes: z.number().nonnegative().optional(),
  downloadComplete: z.boolean().optional(),
  /** ISO timestamp when a CACHE-mode file becomes eligible for TTL eviction. */
  cacheExpiresAt: z.string().optional(),
  subtitles: z.array(SubtitleTrackSchema).optional(),
  audioTracks: z.array(AudioTrackSchema).optional(),
});
export type PlaybackSource = z.infer<typeof PlaybackSourceSchema>;

/** Result of POST /api/playback/resolve (IPTV Play may buffer while caching). */
export const PlaybackResolveResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    source: PlaybackSourceSchema,
  }),
  z.object({
    status: z.literal("buffering"),
    acquisitionId: z.string(),
  }),
]);
export type PlaybackResolveResult = z.infer<typeof PlaybackResolveResultSchema>;
