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

/** Percent of the Seerr (Radarr/Sonarr) download that has landed, or null when nothing is queued. */
export function requestDownloadPercent(media: Pick<Media, "availability">): number | null {
  const seerr = media.availability.find((a) => a.provider === "seerr");
  const progress = seerr?.provider === "seerr" ? seerr.downloadProgress : undefined;
  if (!progress || progress.totalBytes <= 0) return null;
  const done = progress.totalBytes - progress.bytesLeft;
  return Math.max(0, Math.min(99, Math.floor((done / progress.totalBytes) * 100)));
}

export type PrimaryActionKind = "play" | "request" | "requested" | "downloading" | "none";

export interface PrimaryAction {
  kind: PrimaryActionKind;
  /** Button label without the ▶ glyph. */
  label: string;
  /** Download percent for `downloading` (null while the size is unknown). */
  progress: number | null;
  /** One-line explanation of where playback/download comes from. */
  hint: string;
}

/**
 * Single source of truth for the hero/details primary button:
 * library/cache → Play, IPTV → Play on demand, otherwise Request via Seerr,
 * then Requested → Downloading n% until the library picks it up.
 */
export function primaryAction(media: Media): PrimaryAction {
  const resume = resumePositionSeconds(media) != null;
  switch (media.preferredAction) {
    case "PLAY_JELLYFIN":
    case "PLAY_CACHE":
      return { kind: "play", label: resume ? "Resume" : "Play", progress: null, hint: "Ready to play" };
    case "PLAY_IPTV": {
      const percent = requestDownloadPercent(media);
      return {
        kind: "play",
        label: resume ? "Resume on demand" : "Play on demand",
        progress: null,
        hint: percent != null ? `Library copy ${percent}% downloaded` : "",
      };
    }
    case "REQUEST":
      return {
        kind: "request",
        label: "Request",
        progress: null,
        hint: "Not available on demand · Request it for download",
      };
  }
  const seerr = media.availability.find((a) => a.provider === "seerr");
  if (seerr?.provider === "seerr") {
    const percent = requestDownloadPercent(media);
    if (percent != null) {
      return { kind: "downloading", label: `Downloading ${percent}%`, progress: percent, hint: "Requested · Downloading" };
    }
    if (seerr.requestStatus === "PENDING" || (seerr.mediaStatus === "PENDING" && seerr.requestStatus !== "APPROVED")) {
      return { kind: "requested", label: "Requested", progress: null, hint: "Requested · Waiting for approval" };
    }
    if (seerr.mediaStatus === "PROCESSING" || seerr.requestStatus === "APPROVED") {
      return { kind: "requested", label: "Queued", progress: null, hint: "Requested · Looking for a release" };
    }
  }
  return { kind: "none", label: actionLabel(media), progress: null, hint: "" };
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
      const percent = requestDownloadPercent(media);
      if (percent != null) return `Downloading ${percent}%`;
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

/** Poster chip for discovery rails — Request when requestable and not on IPTV. */
export function cardBadge(media: Media): string | undefined {
  if (media.preferredAction === "PLAY_JELLYFIN" || media.preferredAction === "PLAY_CACHE") return "Ready to play";
  if (media.preferredAction === "PLAY_IPTV") return "On demand";
  const percent = requestDownloadPercent(media);
  if (percent != null) return `Downloading ${percent}%`;
  const seerr = media.availability.find((a) => a.provider === "seerr");
  if (seerr?.mediaStatus === "PENDING" || seerr?.requestStatus === "PENDING") {
    return "Requested";
  }
  if (seerr?.mediaStatus === "PROCESSING" || seerr?.requestStatus === "APPROVED") {
    return "Processing";
  }
  const onIptv = media.availability.some((a) => a.provider === "dispatcharr" && a.available);
  if (media.preferredAction === "REQUEST" && !onIptv) {
    return "Request";
  }
  return undefined;
}
