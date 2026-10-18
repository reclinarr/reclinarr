import type { JellyfinItem } from "./schemas.js";

/** Exact TMDb identity — never trust server-side filters alone. */
export function itemMatchesTmdb(item: JellyfinItem, tmdbId: number): boolean {
  const providers = item.ProviderIds ?? {};
  const raw = providers.Tmdb ?? providers.TmdbId ?? providers.TheMovieDb;
  if (raw == null || raw === "") return false;
  return String(raw).replace(/^tmdb:/i, "") === String(tmdbId);
}

export function extractTmdbId(item: JellyfinItem): number | undefined {
  const providers = item.ProviderIds ?? {};
  const raw = providers.Tmdb ?? providers.TmdbId ?? providers.TheMovieDb;
  if (raw == null || raw === "") return undefined;
  const n = Number(String(raw).replace(/^tmdb:/i, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function hasPlayableMedia(item: JellyfinItem): boolean {
  if (typeof item.Path === "string" && item.Path.trim().length > 0) return true;
  const sources = item.MediaSources ?? [];
  return sources.some((s) => typeof s.Path === "string" && s.Path.trim().length > 0);
}

export function ticksToSeconds(ticks?: number | null): number | undefined {
  if (ticks == null || !Number.isFinite(ticks)) return undefined;
  return ticks / 10_000_000;
}
