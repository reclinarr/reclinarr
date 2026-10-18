import type { Media } from "@reclinarr/shared";
import type { AppContext } from "../context.js";
import { MOVIE_GENRE_RAILS, TV_GENRE_RAILS } from "./catalog-genres.js";
import { enrichDiscoveryRow } from "./media-enrichment.js";

export interface CatalogRail {
  id: string;
  title: string;
  items: Media[];
}

export { MOVIE_GENRE_RAILS, TV_GENRE_RAILS };

export function libraryKeysFromItems(items: Media[]): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    const tmdbId = item.identity.tmdbId;
    const mediaType = item.identity.mediaType;
    if (tmdbId && (mediaType === "movie" || mediaType === "tv")) {
      keys.add(`${mediaType}:${tmdbId}`);
    }
  }
  return keys;
}

export function enrichAndFilterRail(
  ctx: AppContext,
  id: string,
  title: string,
  items: Media[],
  libraryKeys?: Set<string>,
): CatalogRail | null {
  if (!items.length) return null;
  const enriched = enrichDiscoveryRow(ctx, items, { libraryKeys });
  if (!enriched.length) return null;
  return { id, title, items: enriched };
}

/** Discovery rails for Home (after personal rows). */
export async function buildHomeDiscoveryRails(ctx: AppContext): Promise<CatalogRail[]> {
  const [trending, popularMovies, popularSeries] = await Promise.all([
    ctx.seerr.discoverTrending({ page: 1 }).catch(() => [] as Media[]),
    ctx.seerr.discoverMovies
      ? ctx.seerr.discoverMovies({ page: 1 }).catch(() => [] as Media[])
      : Promise.resolve([] as Media[]),
    ctx.seerr.discoverTv
      ? ctx.seerr.discoverTv({ page: 1 }).catch(() => [] as Media[])
      : Promise.resolve([] as Media[]),
  ]);

  return [
    enrichAndFilterRail(ctx, "trending", "Trending", trending),
    enrichAndFilterRail(ctx, "popular-movies", "Popular Movies", popularMovies),
    enrichAndFilterRail(ctx, "popular-series", "Popular Series", popularSeries),
  ].filter((r): r is CatalogRail => r != null);
}

/** Discovery rails for Movies / Series pages (library is attached by the route). */
export async function buildCatalogDiscoveryRails(
  ctx: AppContext,
  mediaType: "movie" | "tv",
  libraryKeys: Set<string>,
): Promise<CatalogRail[]> {
  const genres = mediaType === "movie" ? MOVIE_GENRE_RAILS : TV_GENRE_RAILS;

  const trendingPromise = ctx.seerr
    .discoverTrending({ page: 1, mediaType })
    .catch(() => [] as Media[]);
  const popularPromise =
    mediaType === "movie"
      ? ctx.seerr.discoverMovies
        ? ctx.seerr.discoverMovies({ page: 1 }).catch(() => [] as Media[])
        : Promise.resolve([] as Media[])
      : ctx.seerr.discoverTv
        ? ctx.seerr.discoverTv({ page: 1 }).catch(() => [] as Media[])
        : Promise.resolve([] as Media[]);

  const genrePromises = genres.map((g) => {
    if (mediaType === "movie" && ctx.seerr.discoverMovies) {
      return ctx.seerr.discoverMovies({ page: 1, genreId: g.genreId }).catch(() => [] as Media[]);
    }
    if (mediaType === "tv" && ctx.seerr.discoverTv) {
      return ctx.seerr.discoverTv({ page: 1, genreId: g.genreId }).catch(() => [] as Media[]);
    }
    return Promise.resolve([] as Media[]);
  });

  const [trending, popular, ...genreResults] = await Promise.all([
    trendingPromise,
    popularPromise,
    ...genrePromises,
  ]);

  const rails: Array<CatalogRail | null> = [
    enrichAndFilterRail(ctx, "trending", "Trending", trending, libraryKeys),
    enrichAndFilterRail(ctx, "popular", "Popular", popular, libraryKeys),
    ...genres.map((g, i) =>
      enrichAndFilterRail(ctx, g.id, g.title, genreResults[i] ?? [], libraryKeys),
    ),
  ];

  return rails.filter((r): r is CatalogRail => r != null);
}
