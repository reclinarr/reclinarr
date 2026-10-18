import type { Availability, EpisodeListItem, Media } from "@reclinarr/shared";
import { resolvePreferredAction } from "@reclinarr/shared";

/**
 * Build the series episode list.
 *
 * Seerr/TMDb is the guide (titles, overviews, stills) even when Jellyfin has
 * nothing. Jellyfin and IPTV VOD then mark each SxxExx playable on their own —
 * an episode can be missing from the library and still play from IPTV,
 * unless `suppressIptv` is set (series is in the local Jellyfin library).
 */
export function mergeSeriesEpisodes(
  tmdbId: number,
  sources: {
    guide: Media[];
    jellyfin: Media[];
    iptv: Media[];
  },
  cacheAvailabilityFor?: (input: {
    seasonNumber: number;
    episodeNumber: number;
    jellyfinItemId?: string;
  }) => Availability | null | undefined,
  opts?: {
    /** Series is in Jellyfin — never offer IPTV Play for its episodes. */
    suppressIptv?: boolean;
  },
): { seasons: number[]; items: EpisodeListItem[] } {
  const byKey = new Map<string, EpisodeListItem>();

  const upsert = (ep: Media) => {
    const seasonNumber = ep.identity.seasonNumber ?? 0;
    const episodeNumber = ep.identity.episodeNumber ?? 0;
    if (!seasonNumber && !episodeNumber && !ep.identity.jellyfinItemId) return;
    const key = `${seasonNumber}:${episodeNumber}`;
    const existing = byKey.get(key);
    const cacheAvail = cacheAvailabilityFor?.({
      seasonNumber,
      episodeNumber,
      ...(ep.identity.jellyfinItemId ? { jellyfinItemId: ep.identity.jellyfinItemId } : {}),
      ...(existing?.identity.jellyfinItemId
        ? { jellyfinItemId: existing.identity.jellyfinItemId }
        : {}),
    });
    const availability = [
      ...(existing?.availability ?? []),
      ...ep.availability,
      ...(cacheAvail &&
      !(existing?.availability ?? []).some((a) => a.provider === "cache") &&
      !ep.availability.some((a) => a.provider === "cache")
        ? [cacheAvail]
        : []),
    ];
    const seen = new Set<string>();
    const mergedAvail = availability.filter((a) => {
      if (seen.has(a.provider)) return false;
      seen.add(a.provider);
      return true;
    });

    const jellyfinItemId = ep.identity.jellyfinItemId ?? existing?.identity.jellyfinItemId;

    byKey.set(key, {
      identity: {
        ...(existing?.identity ?? {}),
        ...ep.identity,
        ...(jellyfinItemId ? { jellyfinItemId } : {}),
        tmdbId,
        mediaType: "episode",
        seasonNumber,
        episodeNumber,
      },
      title: existing?.title || ep.metadata.title,
      overview: existing?.overview || ep.metadata.overview,
      seasonNumber,
      episodeNumber,
      runtimeMinutes: existing?.runtimeMinutes ?? ep.metadata.runtimeMinutes,
      stillUrl: existing?.stillUrl || ep.metadata.stillUrl,
      airDate: existing?.airDate || ep.metadata.airDate,
      availability: mergedAvail,
      preferredAction: resolvePreferredAction(mergedAvail),
    });
  };

  for (const ep of sources.guide) upsert(ep);
  for (const ep of sources.jellyfin) upsert(ep);
  for (const ep of sources.iptv) upsert(ep);

  const suppressIptv = Boolean(opts?.suppressIptv);
  const items = [...byKey.values()]
    .map((ep) => {
      if (!suppressIptv) return ep;
      const availability = ep.availability.map((a) =>
        a.provider === "dispatcharr" ? { ...a, canPlay: false } : a,
      );
      return {
        ...ep,
        availability,
        preferredAction: resolvePreferredAction(availability),
      };
    })
    .sort(
      (a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber,
    );
  const seasons = [...new Set(items.map((i) => i.seasonNumber))].sort((a, b) => a - b);
  return { seasons, items };
}
