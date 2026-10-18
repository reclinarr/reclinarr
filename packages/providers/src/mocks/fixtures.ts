import type { Availability, Media } from "@reclinarr/shared";
import { resolvePreferredAction } from "@reclinarr/shared";

/** Jellyfin-only movie */
export const jellyfinOnlyMovie: Media = withAction({
  identity: { jellyfinItemId: "jf-1", tmdbId: 100, mediaType: "movie" },
  metadata: { title: "Local Only", year: 2020 },
  availability: [
    {
      provider: "jellyfin",
      available: true,
      itemId: "jf-1",
      canPlay: true,
    },
  ],
  preferredAction: "NONE",
});

/** Cache playable without Jellyfin — must not open IPTV */
export const cachePlayableMovie: Media = withAction({
  identity: { tmdbId: 269149, mediaType: "movie" },
  metadata: { title: "Zootopia", year: 2016 },
  availability: [
    {
      provider: "cache",
      available: true,
      playbackAvailable: true,
      complete: false,
      bytesDownloaded: 900,
      totalBytes: 1000,
      acquisitionId: "acq-1",
    },
    {
      provider: "dispatcharr",
      available: true,
      canPlay: true,
      uuid: "uuid-zootopia",
      candidates: [],
    },
  ],
  preferredAction: "NONE",
});

/** Dispatcharr-only IPTV */
export const dispatcharrOnlyMovie: Media = withAction({
  identity: { tmdbId: 200, mediaType: "movie" },
  metadata: { title: "IPTV Only", year: 2021 },
  availability: [
    {
      provider: "dispatcharr",
      available: true,
      canPlay: true,
      uuid: "uuid-iptv",
      candidates: [{ streamId: "1", label: "EN 1080p" }],
    },
  ],
  preferredAction: "NONE",
});

/** Requestable via Seerr */
export const requestableMovie: Media = withAction({
  identity: { tmdbId: 300, mediaType: "movie" },
  metadata: { title: "Needs Request", year: 2022 },
  availability: [
    {
      provider: "seerr",
      requestable: true,
      mediaStatus: "UNKNOWN",
    },
  ],
  preferredAction: "NONE",
});

/** Partial TV series availability across sources */
export const partialTvSeriesAvailability: Availability[] = [
  {
    provider: "jellyfin",
    available: true,
    itemId: "ep1",
    canPlay: true,
  },
  {
    provider: "dispatcharr",
    available: true,
    canPlay: true,
    episodeId: 2,
    uuid: "ep2-uuid",
    candidates: [],
  },
  {
    provider: "seerr",
    requestable: true,
    mediaStatus: "PENDING",
  },
];

function withAction(media: Media): Media {
  return {
    ...media,
    preferredAction: resolvePreferredAction(media.availability),
  };
}
