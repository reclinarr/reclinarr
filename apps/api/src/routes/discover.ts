import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import { enrichDiscoveryRow } from "../services/media-enrichment.js";

export async function registerDiscoverRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/discover/trending", async (req) => {
    await requireAuth(req);
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
    await requireAuth(req);
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
    await requireAuth(req);
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
    await requireAuth(req);
    const query = z
      .object({
        q: z.string().min(1),
        page: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);

    const items = await ctx.seerr.search(query.q, { page: query.page });
    return { items: enrichDiscoveryRow(ctx, items), query: query.q };
  });
}
