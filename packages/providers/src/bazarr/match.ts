export interface BazarrMovieLike {
  imdbId?: string | null;
  title?: string | null;
  year?: string | number | null;
}

export interface BazarrSeriesLike {
  imdbId?: string | null;
  tvdbId?: number | string | null;
  title?: string | null;
  year?: string | number | null;
}

export interface BazarrEpisodeLike {
  season?: number | null;
  episode?: number | null;
}

export function normImdb(id?: string | null): string | undefined {
  if (!id) return undefined;
  const trimmed = id.trim().toLowerCase();
  if (!trimmed || trimmed === "none" || trimmed === "null") return undefined;
  const digits = trimmed.replace(/^tt/, "");
  if (!/^\d+$/.test(digits)) return trimmed;
  return `tt${digits}`;
}

export function normTitle(title?: string | null): string {
  return (title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchMovie<T extends BazarrMovieLike>(
  movies: T[],
  query: { imdbId?: string; title?: string; year?: number },
): T | undefined {
  const imdb = normImdb(query.imdbId);
  if (imdb) {
    const hit = movies.find((movie) => normImdb(movie.imdbId) === imdb);
    if (hit) return hit;
  }
  const title = normTitle(query.title);
  if (!title) return undefined;
  const titled = movies.filter((movie) => normTitle(movie.title) === title);
  if (query.year != null) {
    const yearHit = titled.find((movie) => Number(movie.year) === query.year);
    if (yearHit) return yearHit;
  }
  return titled.length === 1 ? titled[0] : undefined;
}

export function matchSeries<T extends BazarrSeriesLike>(
  series: T[],
  query: { imdbId?: string; tvdbId?: number; title?: string; year?: number },
): T | undefined {
  if (query.tvdbId != null) {
    const hit = series.find((show) => Number(show.tvdbId) === query.tvdbId);
    if (hit) return hit;
  }
  const imdb = normImdb(query.imdbId);
  if (imdb) {
    const hit = series.find((show) => normImdb(show.imdbId) === imdb);
    if (hit) return hit;
  }
  const title = normTitle(query.title);
  if (!title) return undefined;
  const titled = series.filter((show) => normTitle(show.title) === title);
  if (query.year != null) {
    const yearHit = titled.find((show) => Number(show.year) === query.year);
    if (yearHit) return yearHit;
  }
  return titled.length === 1 ? titled[0] : undefined;
}

export function matchEpisode<T extends BazarrEpisodeLike>(
  episodes: T[],
  seasonNumber?: number,
  episodeNumber?: number,
): T | undefined {
  if (seasonNumber == null || episodeNumber == null) return undefined;
  return episodes.find(
    (episode) => episode.season === seasonNumber && episode.episode === episodeNumber,
  );
}
