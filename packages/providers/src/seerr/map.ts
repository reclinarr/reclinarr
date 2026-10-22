import type { CreditPerson, Media, MediaIdentity, RequestAvailability } from "@reclinarr/shared";
import { resolvePreferredAction } from "@reclinarr/shared";
import {
  MEDIA_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  SeerrMediaStatus,
  type SeerrMediaInfo,
  type SeerrMovieDetails,
  type SeerrSearchResult,
  type SeerrTvDetails,
  type SeerrTvEpisode,
} from "./schemas.js";

const TMDB_IMG = "https://image.tmdb.org/t/p";

export function tmdbImageUrl(
  path: string | null | undefined,
  size: "w185" | "w300" | "w500" | "w1280",
): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path.replace("/original/", `/${size}/`);
  return `${TMDB_IMG}/${size}${path.startsWith("/") ? path : `/${path}`}`;
}

type SeerrCreditLike = {
  id?: number;
  name?: string;
  original_name?: string;
  character?: string | null;
  job?: string | null;
  profilePath?: string | null;
  profile_path?: string | null;
  order?: number | null;
};

/** Prefer an official YouTube Trailer from Seerr relatedVideos. */
export function pickTrailer(details: {
  relatedVideos?: Array<{
    url?: string;
    key?: string;
    type?: string;
    site?: string;
  }> | null;
}): { trailerUrl?: string; trailerYoutubeKey?: string } {
  const videos = details.relatedVideos ?? [];
  const ranked = [...videos].sort((a, b) => {
    const score = (v: (typeof videos)[number]) => {
      let s = 0;
      if (/trailer/i.test(v.type ?? "")) s += 4;
      if (/youtube/i.test(v.site ?? "")) s += 2;
      if (/official/i.test(v.type ?? "")) s += 1;
      return s;
    };
    return score(b) - score(a);
  });
  for (const v of ranked) {
    const key =
      v.key?.trim() ||
      (typeof v.url === "string"
        ? /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/i.exec(v.url)?.[1]
        : undefined);
    if (!key) continue;
    if (v.site && !/youtube/i.test(v.site) && !v.url?.includes("youtu")) continue;
    return {
      trailerYoutubeKey: key,
      trailerUrl: `https://www.youtube.com/watch?v=${key}`,
    };
  }
  return {};
}

function creditPerson(
  person: SeerrCreditLike,
  role?: string | null,
): CreditPerson | null {
  const name = (person.name || person.original_name || "").trim();
  if (!name) return null;
  const profilePath = person.profilePath ?? person.profile_path;
  return {
    ...(typeof person.id === "number" ? { tmdbId: person.id } : {}),
    name,
    ...(role?.trim() ? { role: role.trim() } : {}),
    ...(tmdbImageUrl(profilePath, "w185")
      ? { profileUrl: tmdbImageUrl(profilePath, "w185") }
      : {}),
  };
}

function mapCredits(details: {
  credits?: { cast?: SeerrCreditLike[]; crew?: SeerrCreditLike[] } | null;
  createdBy?: SeerrCreditLike[];
  genres?: Array<{ name: string }>;
  productionCompanies?: Array<{ name: string }>;
  networks?: Array<{ name: string }>;
  keywords?: Array<{ name: string }>;
  tagline?: string | null;
  mediaType: "movie" | "tv";
}) {
  const cast = (details.credits?.cast ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .map((p) => creditPerson(p, p.character))
    .filter((p): p is CreditPerson => p != null)
    .slice(0, 24);

  const crew = details.credits?.crew ?? [];
  const directors = crew
    .filter((c) => c.job === "Director")
    .map((p) => creditPerson(p, p.job))
    .filter((p): p is CreditPerson => p != null);
  const writers = crew
    .filter((c) => c.job === "Writer" || c.job === "Screenplay" || c.job === "Story")
    .map((p) => creditPerson(p, p.job))
    .filter((p): p is CreditPerson => p != null);
  const creatorsFromShow = (details.createdBy ?? [])
    .map((p) => creditPerson(p, "Creator"))
    .filter((p): p is CreditPerson => p != null);

  const creators =
    details.mediaType === "tv"
      ? (creatorsFromShow.length ? creatorsFromShow : directors)
      : directors;

  const studios = [
    ...(details.networks ?? []).map((n) => n.name),
    ...(details.productionCompanies ?? []).map((c) => c.name),
  ].filter(Boolean);

  return {
    ...(details.tagline?.trim() ? { tagline: details.tagline.trim() } : {}),
    genres: details.genres?.map((g) => g.name).filter(Boolean),
    ...(studios.length ? { studios: [...new Set(studios)].slice(0, 8) } : {}),
    keywords: details.keywords?.map((k) => k.name).filter(Boolean).slice(0, 12),
    ...(cast.length ? { cast } : {}),
    ...(creators.length ? { creators: uniquePeople(creators).slice(0, 8) } : {}),
    ...(writers.length ? { writers: uniquePeople(writers).slice(0, 8) } : {}),
  };
}

function uniquePeople(people: CreditPerson[]): CreditPerson[] {
  const seen = new Set<string>();
  const out: CreditPerson[] = [];
  for (const p of people) {
    const key = String(p.tmdbId ?? p.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function yearFromDate(date?: string | null): number | undefined {
  if (!date || date.length < 4) return undefined;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) ? y : undefined;
}

export function mapMediaInfoToRequestAvailability(
  mediaInfo?: SeerrMediaInfo | null,
): RequestAvailability {
  const mediaStatusNum = mediaInfo?.status ?? SeerrMediaStatus.UNKNOWN;
  const mediaStatus = MEDIA_STATUS_LABEL[mediaStatusNum] ?? "UNKNOWN";

  const latestRequest = mediaInfo?.requests?.[0];
  const requestStatus =
    latestRequest?.status !== undefined
      ? (REQUEST_STATUS_LABEL[latestRequest.status] ?? String(latestRequest.status))
      : undefined;

  const availableInLibrary =
    mediaStatusNum === SeerrMediaStatus.AVAILABLE ||
    mediaStatusNum === SeerrMediaStatus.PARTIALLY_AVAILABLE;

  const blocked = mediaStatusNum === SeerrMediaStatus.BLOCKLISTED;
  const alreadyPending =
    mediaStatusNum === SeerrMediaStatus.PENDING ||
    mediaStatusNum === SeerrMediaStatus.PROCESSING ||
    requestStatus === "PENDING" ||
    requestStatus === "APPROVED";

  const downloadProgress = mapDownloadProgress(mediaInfo?.downloadStatus);

  return {
    provider: "seerr",
    requestable: !blocked && !availableInLibrary && !alreadyPending && !downloadProgress,
    requestStatus,
    mediaStatus,
    ...(downloadProgress ? { downloadProgress } : {}),
  };
}

function mapDownloadProgress(
  items: SeerrMediaInfo["downloadStatus"],
): RequestAvailability["downloadProgress"] {
  const sized = (items ?? []).filter((item) => typeof item.size === "number" && item.size > 0);
  if (!sized.length) return undefined;
  let totalBytes = 0;
  let bytesLeft = 0;
  let estimatedCompletionTime: string | undefined;
  for (const item of sized) {
    const size = item.size!;
    totalBytes += size;
    bytesLeft += Math.min(size, Math.max(0, item.sizeLeft ?? size));
    const eta = item.estimatedCompletionTime ?? undefined;
    if (eta && (!estimatedCompletionTime || eta > estimatedCompletionTime)) {
      estimatedCompletionTime = eta;
    }
  }
  return {
    totalBytes,
    bytesLeft,
    ...(estimatedCompletionTime ? { estimatedCompletionTime } : {}),
  };
}

export function mapSearchResultToMedia(result: SeerrSearchResult): Media | null {
  if (result.mediaType !== "movie" && result.mediaType !== "tv") return null;

  const title =
    result.mediaType === "movie"
      ? (result.title ?? result.originalTitle ?? "Untitled")
      : (result.name ?? result.originalName ?? "Untitled");

  const date = result.mediaType === "movie" ? result.releaseDate : result.firstAirDate;
  const seerrAvail = mapMediaInfoToRequestAvailability(result.mediaInfo);
  const availability = [seerrAvail];

  return {
    identity: {
      tmdbId: result.id,
      mediaType: result.mediaType,
      ...(result.mediaInfo?.tvdbId ? { tvdbId: result.mediaInfo.tvdbId } : {}),
    },
    metadata: {
      title,
      originalTitle:
        result.mediaType === "movie" ? result.originalTitle : result.originalName,
      originalLanguage: result.originalLanguage ?? undefined,
      year: yearFromDate(date),
      overview: result.overview ?? undefined,
      posterUrl: tmdbImageUrl(result.posterPath, "w500"),
      backdropUrl: tmdbImageUrl(result.backdropPath, "w1280"),
    },
    availability,
    preferredAction: resolvePreferredAction(availability),
  };
}

export function mapMovieDetailsToMedia(details: SeerrMovieDetails): Media {
  const seerrAvail = mapMediaInfoToRequestAvailability(details.mediaInfo);
  const availability = [seerrAvail];
  const extras = mapCredits({ ...details, mediaType: "movie" });
  const trailer = pickTrailer(details);
  return {
    identity: {
      tmdbId: details.id,
      mediaType: "movie",
      ...(details.mediaInfo?.tvdbId ? { tvdbId: details.mediaInfo.tvdbId } : {}),
    },
    metadata: {
      title: details.title,
      originalTitle: details.originalTitle,
      originalLanguage: details.originalLanguage ?? undefined,
      year: yearFromDate(details.releaseDate),
      overview: details.overview ?? undefined,
      posterUrl: tmdbImageUrl(details.posterPath, "w500"),
      backdropUrl: tmdbImageUrl(details.backdropPath, "w1280"),
      runtimeMinutes: details.runtime ?? undefined,
      ...extras,
      ...trailer,
    },
    availability,
    preferredAction: resolvePreferredAction(availability),
  };
}

export function mapTvDetailsToMedia(details: SeerrTvDetails): Media {
  const seerrAvail = mapMediaInfoToRequestAvailability(details.mediaInfo);
  const availability = [seerrAvail];
  const extras = mapCredits({ ...details, mediaType: "tv" });
  const trailer = pickTrailer(details);
  return {
    identity: {
      tmdbId: details.id,
      mediaType: "tv",
      ...(details.mediaInfo?.tvdbId ? { tvdbId: details.mediaInfo.tvdbId } : {}),
    },
    metadata: {
      title: details.name,
      originalTitle: details.originalName,
      originalLanguage: details.originalLanguage ?? undefined,
      year: yearFromDate(details.firstAirDate),
      overview: details.overview ?? undefined,
      posterUrl: tmdbImageUrl(details.posterPath, "w500"),
      backdropUrl: tmdbImageUrl(details.backdropPath, "w1280"),
      runtimeMinutes: details.episodeRunTime?.find((n) => n > 0),
      seriesStatus: details.status || undefined,
      ...extras,
      ...trailer,
    },
    availability,
    preferredAction: resolvePreferredAction(availability),
  };
}

/** One TMDb episode row. Playability is filled in later from Jellyfin and IPTV. */
export function mapSeerrEpisodeToMedia(
  episode: SeerrTvEpisode,
  seriesTmdbId: number,
  seasonNumber: number,
  seasonStatus?: number,
): Media {
  const seerrAvail = mapMediaInfoToRequestAvailability(
    seasonStatus != null ? { status: seasonStatus } : null,
  );
  const availability = [seerrAvail];
  const episodeNumber = episode.episodeNumber;
  return {
    identity: {
      tmdbId: seriesTmdbId,
      mediaType: "episode",
      seasonNumber: episode.seasonNumber ?? seasonNumber,
      episodeNumber,
    },
    metadata: {
      title: episode.name?.trim() || `Episode ${episodeNumber}`,
      overview: episode.overview ?? undefined,
      runtimeMinutes: episode.runtime && episode.runtime > 0 ? episode.runtime : undefined,
      stillUrl: tmdbImageUrl(episode.stillPath, "w300"),
      airDate: episode.airDate ?? undefined,
    },
    availability,
    preferredAction: resolvePreferredAction(availability),
  };
}

export function identityNeedsTmdb(identity: MediaIdentity): identity is MediaIdentity & {
  tmdbId: number;
  mediaType: "movie" | "tv";
} {
  return (
    typeof identity.tmdbId === "number" &&
    (identity.mediaType === "movie" || identity.mediaType === "tv")
  );
}
