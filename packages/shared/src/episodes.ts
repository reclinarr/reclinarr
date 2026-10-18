import { z } from "zod";
import { AvailabilitySchema, PreferredActionSchema } from "./media.js";
import { MediaIdentitySchema } from "./identity.js";

/** Compact episode row for series detail / episode pickers. */
export const EpisodeListItemSchema = z.object({
  identity: MediaIdentitySchema,
  title: z.string(),
  overview: z.string().optional(),
  seasonNumber: z.number().int().nonnegative(),
  episodeNumber: z.number().int().nonnegative(),
  runtimeMinutes: z.number().optional(),
  stillUrl: z.string().optional(),
  airDate: z.string().optional(),
  availability: z.array(AvailabilitySchema),
  preferredAction: PreferredActionSchema,
});
export type EpisodeListItem = z.infer<typeof EpisodeListItemSchema>;
