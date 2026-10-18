import type { Media } from "@reclinarr/shared";
import type { UserContext } from "@reclinarr/providers";
import type { AppContext } from "../context.js";

export async function hydrateContinueWatching(
  ctx: Pick<AppContext, "jellyfin">,
  user: UserContext,
  items: Media[],
): Promise<Media[]> {
  const seriesLookups = new Map<string, Promise<Media | null>>();
  return Promise.all(items.map(async (item) => {
    let media = item;
    if (item.identity.jellyfinItemId && !item.identity.jellyfinSeriesId && item.identity.mediaType === "episode") {
      const library = await ctx.jellyfin.getByJellyfinItemId(user, item.identity.jellyfinItemId).catch(() => null);
      if (library) {
        media = {
          ...library,
          identity: { ...item.identity, ...library.identity },
          availability: library.availability.map((entry) => {
            const progress = item.availability.find((value) => value.provider === entry.provider);
            return {
              ...entry,
              ...(progress && "positionSeconds" in progress ? { positionSeconds: progress.positionSeconds } : {}),
              ...(progress && "durationSeconds" in progress ? { durationSeconds: progress.durationSeconds } : {}),
            };
          }),
        };
      }
    }
    const seriesId = media.identity.jellyfinSeriesId;
    if (!seriesId || media.identity.mediaType !== "episode") return media;
    let lookup = seriesLookups.get(seriesId);
    if (!lookup) {
      lookup = ctx.jellyfin.getByJellyfinItemId(user, seriesId).catch(() => null);
      seriesLookups.set(seriesId, lookup);
    }
    const series = await lookup;
    if (!series?.identity.tmdbId) return media;
    return {
      ...media,
      identity: { ...media.identity, tmdbId: series.identity.tmdbId },
      metadata: {
        ...media.metadata,
        posterUrl: media.metadata.posterUrl ?? series.metadata.posterUrl,
        backdropUrl: media.metadata.backdropUrl ?? series.metadata.backdropUrl,
      },
    };
  }));
}

export function continueSeriesKey(media: Media): string {
  const identity = media.identity;
  if (identity.mediaType === "episode" || identity.mediaType === "tv") {
    if (identity.tmdbId != null) return `series:tmdb:${identity.tmdbId}`;
    if (identity.jellyfinSeriesId) return `series:jf:${identity.jellyfinSeriesId}`;
    if (identity.mediaType === "tv" && identity.jellyfinItemId) return `series:jf:${identity.jellyfinItemId}`;
  }
  return `${identity.mediaType}:${identity.tmdbId ?? identity.jellyfinItemId ?? ""}`;
}
