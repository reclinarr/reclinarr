import type { Media } from "@reclinarr/shared";

export function mediaHref(media: Media): string | null {
  const { jellyfinItemId, jellyfinSeriesId, tmdbId, mediaType } = media.identity;
  // Netflix-style: episode cards link to the series details page.
  if (mediaType === "episode") {
    if (jellyfinSeriesId) {
      return `/media/jellyfin/${encodeURIComponent(jellyfinSeriesId)}`;
    }
    if (tmdbId) return `/media/tv/${tmdbId}`;
    if (jellyfinItemId) {
      return `/media/jellyfin/${encodeURIComponent(jellyfinItemId)}`;
    }
    return null;
  }
  if (tmdbId && (mediaType === "movie" || mediaType === "tv")) {
    return `/media/${mediaType}/${tmdbId}`;
  }
  if (jellyfinItemId) {
    return `/media/jellyfin/${encodeURIComponent(jellyfinItemId)}`;
  }
  return null;
}

export function canPlayMedia(media: Pick<Media, "preferredAction">): boolean {
  return (
    media.preferredAction === "PLAY_JELLYFIN" ||
    media.preferredAction === "PLAY_CACHE" ||
    media.preferredAction === "PLAY_IPTV"
  );
}

export function formatRuntime(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function resumePositionSeconds(media: Media): number | undefined {
  for (const a of media.availability) {
    if (
      (a.provider === "jellyfin" || a.provider === "dispatcharr" || a.provider === "cache") &&
      "positionSeconds" in a &&
      typeof a.positionSeconds === "number" &&
      a.positionSeconds > 30
    ) {
      return a.positionSeconds;
    }
  }
  return undefined;
}

export function actionLabel(media: Media): string {
  switch (media.preferredAction) {
    case "PLAY_JELLYFIN":
    case "PLAY_CACHE": {
      return resumePositionSeconds(media) != null ? "▶ Resume" : "▶ Play";
    }
    case "PLAY_IPTV": {
      if (resumePositionSeconds(media) != null) {
        return "▶ Resume on demand";
      }
      return "▶ Play on demand";
    }
    case "REQUEST":
      return "＋ Request";
    default: {
      const iptv = media.availability.find((a) => a.provider === "dispatcharr");
      if (iptv?.available && !iptv.canPlay) {
        return "On IPTV";
      }
      const seerr = media.availability.find((a) => a.provider === "seerr");
      if (seerr?.mediaStatus === "PENDING" || seerr?.requestStatus === "PENDING") {
        return "Requested";
      }
      if (seerr?.mediaStatus === "PROCESSING" || seerr?.requestStatus === "APPROVED") {
        return "Processing";
      }
      if (seerr?.mediaStatus === "AVAILABLE" || seerr?.mediaStatus === "PARTIALLY_AVAILABLE") {
        return "In library";
      }
      return "Unavailable";
    }
  }
}

/** Poster chip for discovery rails — Download when requestable and not on IPTV. */
export function cardBadge(media: Media): string | undefined {
  if (media.preferredAction === "PLAY_JELLYFIN" || media.preferredAction === "PLAY_CACHE") return "Ready to play";
  if (media.preferredAction === "PLAY_IPTV") return "On demand";
  const seerr = media.availability.find((a) => a.provider === "seerr");
  if (seerr?.mediaStatus === "PENDING" || seerr?.requestStatus === "PENDING") {
    return "Requested";
  }
  if (seerr?.mediaStatus === "PROCESSING" || seerr?.requestStatus === "APPROVED") {
    return "Processing";
  }
  const onIptv = media.availability.some((a) => a.provider === "dispatcharr" && a.available);
  if (media.preferredAction === "REQUEST" && !onIptv) {
    return "Download";
  }
  return undefined;
}
