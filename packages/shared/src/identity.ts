import { z } from "zod";

export const MediaTypeSchema = z.enum(["movie", "tv", "episode", "other"]);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const MediaIdentitySchema = z.object({
  jellyfinItemId: z.string().optional(),
  /** Parent series id when this row is an episode (for TMDb series artwork). */
  jellyfinSeriesId: z.string().optional(),
  tmdbId: z.number().int().positive().optional(),
  tvdbId: z.number().int().positive().optional(),
  mediaType: MediaTypeSchema,
  seasonNumber: z.number().int().nonnegative().optional(),
  episodeNumber: z.number().int().nonnegative().optional(),
});
export type MediaIdentity = z.infer<typeof MediaIdentitySchema>;

export function hasCanonicalTmdb(identity: MediaIdentity): boolean {
  return typeof identity.tmdbId === "number";
}

export function hasJellyfinId(identity: MediaIdentity): boolean {
  return typeof identity.jellyfinItemId === "string" && identity.jellyfinItemId.length > 0;
}
