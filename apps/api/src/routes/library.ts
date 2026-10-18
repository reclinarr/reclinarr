import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import { applyTmdbArtwork } from "../services/media-enrichment.js";

export async function registerLibraryRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/library/:mediaType", async (req) => {
    const { userContext } = await requireAuth(req);
    const params = z.object({ mediaType: z.enum(["movie", "tv"]) }).parse(req.params);
    const query = z
      .object({
        startIndex: z.coerce.number().int().nonnegative().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        search: z.string().optional(),
        sortBy: z.string().optional(),
      })
      .parse(req.query);

    if (!ctx.jellyfin.listLibrary) {
      return { items: [], total: 0 };
    }

    const result = await ctx.jellyfin.listLibrary(userContext, {
      mediaType: params.mediaType,
      startIndex: query.startIndex,
      limit: query.limit ?? 48,
      search: query.search,
      sortBy: query.sortBy,
    });
    return {
      ...result,
      items: await applyTmdbArtwork(ctx, result.items, userContext),
    };
  });
}
