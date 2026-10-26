import { z } from "zod";
import { AvailabilitySchema, PreferredActionSchema, type Availability } from "./media.js";
import { MediaIdentitySchema } from "./identity.js";

/** Fraction of runtime after which an episode counts as fully watched. */
export const WATCHED_THRESHOLD = 0.9;

/** Jellyfin marked it played, or any provider's position is past WATCHED_THRESHOLD. */
export function isWatchedByAvailability(availability: Availability[]): boolean {
  return availability.some(
    (a) =>
      (a.provider === "jellyfin" && a.played === true) ||
      ("positionSeconds" in a &&
        "durationSeconds" in a &&
        typeof a.positionSeconds === "number" &&
        typeof a.durationSeconds === "number" &&
        a.durationSeconds > 0 &&
        a.positionSeconds / a.durationSeconds >= WATCHED_THRESHOLD),
  );
}

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
  /** Fully watched (past WATCHED_THRESHOLD, or marked played in Jellyfin). */
  watched: z.boolean().optional(),
});
export type EpisodeListItem = z.infer<typeof EpisodeListItemSchema>;

/**
 * The episode to continue with when nothing is in progress: the one the user opened if it is
 * unwatched and playable, else the first unwatched playable episode after their furthest
 * watched regular episode. `items` must be in season/episode order. Null if nothing is watched.
 */
export function pickNextUpEpisode(
  items: EpisodeListItem[],
  isPlayable: (ep: EpisodeListItem) => boolean,
  focus?: { seasonNumber: number; episodeNumber: number } | null,
): EpisodeListItem | null {
  if (focus) {
    const focused = items.find(
      (ep) => ep.seasonNumber === focus.seasonNumber && ep.episodeNumber === focus.episodeNumber,
    );
    if (focused && !focused.watched && isPlayable(focused)) return focused;
  }
  let lastWatched = -1;
  items.forEach((ep, i) => {
    if (ep.seasonNumber > 0 && ep.watched) lastWatched = i;
  });
  if (lastWatched < 0) return null;
  return (
    items
      .slice(lastWatched + 1)
      .find((ep) => ep.seasonNumber > 0 && !ep.watched && isPlayable(ep)) ?? null
  );
}
