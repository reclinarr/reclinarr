import type { DispatcharrStreamCandidate, Media } from "@reclinarr/shared";
import { parseCatalogueLanguageHints, resolvePreferredAction } from "@reclinarr/shared";
import type { DispatcharrEpisode, DispatcharrMovie, DispatcharrSeries } from "./schemas.js";

export function parseTmdbId(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = Number(String(raw).replace(/^tmdb:/i, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function logoUrl(logo: DispatcharrMovie["logo"]): string | undefined {
  if (!logo) return undefined;
  return logo.cache_url || logo.url || undefined;
}

/** Map Dispatcharr `duration_secs` into Media metadata fields. */
export function durationFromSecs(secs?: number | null): {
  durationSeconds?: number;
  runtimeMinutes?: number;
} {
  if (secs == null || !(secs > 0) || !Number.isFinite(secs)) return {};
  const durationSeconds = Math.floor(secs);
  return {
    durationSeconds,
    runtimeMinutes: Math.max(1, Math.round(durationSeconds / 60)),
  };
}

export function mapMovieToMedia(
  movie: DispatcharrMovie,
  opts?: {
    candidates?: DispatcharrStreamCandidate[];
    catalogueLanguage?: string;
  },
): Media {
  const tmdbId = parseTmdbId(movie.tmdb_id);
  const candidates = opts?.candidates ?? [];
  const catalogueLanguage =
    opts?.catalogueLanguage ?? parseCatalogueLanguageHints({ name: movie.name }).language;
  const availability = [
    {
      provider: "dispatcharr" as const,
      available: true,
      movieId: movie.id,
      uuid: movie.uuid,
      tmdbId: movie.tmdb_id != null ? String(movie.tmdb_id) : undefined,
      imdbId: movie.imdb_id ?? undefined,
      catalogueLanguage,
      candidates,
      canPlay: true,
    },
  ];
  return {
    identity: {
      ...(tmdbId !== undefined ? { tmdbId } : {}),
      mediaType: "movie",
    },
    metadata: {
      title: movie.name,
      year: movie.year ?? undefined,
      overview: movie.description ?? undefined,
      posterUrl: logoUrl(movie.logo),
      ...durationFromSecs(movie.duration_secs),
    },
    availability,
    preferredAction: resolvePreferredAction(availability),
  };
}

export function mapSeriesToMedia(
  series: DispatcharrSeries,
  opts?: { catalogueLanguage?: string },
): Media {
  const tmdbId = parseTmdbId(series.tmdb_id);
  const catalogueLanguage =
    opts?.catalogueLanguage ?? parseCatalogueLanguageHints({ name: series.name }).language;
  const availability = [
    {
      provider: "dispatcharr" as const,
      available: true,
      seriesId: series.id,
      uuid: series.uuid,
      tmdbId: series.tmdb_id != null ? String(series.tmdb_id) : undefined,
      imdbId: series.imdb_id ?? undefined,
      catalogueLanguage,
      candidates: [],
      // Episode-level play lands in Phase 7; mark series available but not directly playable.
      canPlay: false,
    },
  ];
  return {
    identity: {
      ...(tmdbId !== undefined ? { tmdbId } : {}),
      mediaType: "tv",
    },
    metadata: {
      title: series.name,
      year: series.year ?? undefined,
      overview: series.description ?? undefined,
      posterUrl: logoUrl(series.logo),
    },
    availability,
    preferredAction: resolvePreferredAction(availability),
  };
}

export function mapEpisodeToMedia(episode: DispatcharrEpisode, seriesTmdbId?: number): Media {
  const availability = [
    {
      provider: "dispatcharr" as const,
      available: true,
      episodeId: episode.id,
      seriesId: episode.series?.id,
      uuid: episode.uuid,
      candidates: [],
      canPlay: true,
    },
  ];
  const numbers = seasonEpisodeNumbers(episode);
  const ep = numbers.episode ?? 0;
  // Titles often look like "EN - Show - S01E01 - Pilot"
  const raw = episode.name ?? "";
  const seMatch = raw.match(/S(\d+)\s*E(\d+)\s*[-–:]\s*(.+)$/i);
  const epTitle = seMatch?.[3]?.trim() || raw || `Episode ${ep}`;
  return {
    identity: {
      ...(seriesTmdbId !== undefined ? { tmdbId: seriesTmdbId } : {}),
      mediaType: "episode",
      ...(numbers.season != null ? { seasonNumber: numbers.season } : {}),
      ...(numbers.episode != null ? { episodeNumber: numbers.episode } : {}),
    },
    metadata: {
      title: epTitle,
      overview: episode.description ?? undefined,
      ...durationFromSecs(episode.duration_secs),
    },
    availability,
    preferredAction: resolvePreferredAction(availability),
  };
}

/** IPTV rows sometimes omit season_number and only encode SxxExx in the title. */
function seasonEpisodeNumbers(episode: DispatcharrEpisode): {
  season?: number;
  episode?: number;
} {
  let season = finiteInt(episode.season_number);
  let ep = finiteInt(episode.episode_number);
  const missing = (season == null && ep == null) || (season === 0 && ep === 0);
  if (missing) {
    const match = (episode.name ?? "").match(/S(\d+)\s*E(\d+)/i);
    if (match) {
      season = Number(match[1]);
      ep = Number(match[2]);
    }
  }
  return { season, episode: ep };
}

function finiteInt(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

export function tmdbMatches(
  raw: string | number | null | undefined,
  tmdbId: number,
): boolean {
  return parseTmdbId(raw) === tmdbId;
}
