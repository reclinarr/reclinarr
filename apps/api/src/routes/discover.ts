import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Media } from "@reclinarr/shared";
import type { UserContext } from "@reclinarr/providers";
import type { AppContext } from "../context.js";
import { isDemoSession, requireAuth } from "../plugins/auth.js";
import { applyTmdbArtwork, enrichDiscoveryRow } from "../services/media-enrichment.js";

/** Demo accounts search the Jellyfin library instead of Seerr's TMDb catalogue. */
async function searchLibrary(ctx: AppContext, userContext: UserContext, q: string): Promise<Media[]> {
  const listLibrary = ctx.jellyfin.listLibrary?.bind(ctx.jellyfin);
  if (!listLibrary) return [];
  const results = await Promise.all(
    (["movie", "tv"] as const).map((mediaType) =>
      listLibrary(userContext, { mediaType, search: q, limit: 24 }),
    ),
  );
  return applyTmdbArtwork(ctx, results.flatMap((r) => r.items), userContext);
}

export async function registerDiscoverRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/discover/trending", async (req) => {
    const { session } = await requireAuth(req);
    if (isDemoSession(ctx, session)) return { items: [] as Media[] };
    const query = z
      .object({
        page: z.coerce.number().int().positive().optional(),
        mediaType: z.enum(["movie", "tv"]).optional(),
      })
      .parse(req.query);

    const items = await ctx.seerr.discoverTrending(query);
    return { items: enrichDiscoveryRow(ctx, items) };
  });

  app.get("/api/discover/movies", async (req) => {
    const { session } = await requireAuth(req);
    if (isDemoSession(ctx, session)) return { items: [] as Media[] };
    const query = z
      .object({
        page: z.coerce.number().int().positive().optional(),
        genreId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);

    const items = ctx.seerr.discoverMovies
      ? await ctx.seerr.discoverMovies(query)
      : await ctx.seerr.discoverTrending({ ...query, mediaType: "movie" });
    return { items: enrichDiscoveryRow(ctx, items) };
  });

  app.get("/api/discover/tv", async (req) => {
    const { session } = await requireAuth(req);
    if (isDemoSession(ctx, session)) return { items: [] as Media[] };
    const query = z
      .object({
        page: z.coerce.number().int().positive().optional(),
        genreId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);

    const items = ctx.seerr.discoverTv
      ? await ctx.seerr.discoverTv(query)
      : await ctx.seerr.discoverTrending({ ...query, mediaType: "tv" });
    return { items: enrichDiscoveryRow(ctx, items) };
  });

  app.get("/api/search", async (req) => {
    const { session, userContext } = await requireAuth(req);
    const query = z
      .object({
        q: z.string().min(1),
        page: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);

    if (isDemoSession(ctx, session)) {
      const items = (query.page ?? 1) > 1 ? [] : await searchLibrary(ctx, userContext, query.q);
      return { items, query: query.q };
    }

    const items = await ctx.seerr.search(query.q, { page: query.page });
    return { items: enrichDiscoveryRow(ctx, items), query: query.q };
  });
}
