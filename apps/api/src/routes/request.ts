import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MediaIdentitySchema } from "@reclinarr/shared";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import { resolveMediaByTmdb } from "../services/media-enrichment.js";

export async function registerRequestRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/requests", async (req) => {
    await requireAuth(req);
    const query = z
      .object({
        take: z.coerce.number().int().positive().max(100).optional(),
        skip: z.coerce.number().int().nonnegative().optional(),
        filter: z.string().optional(),
        mediaType: z.enum(["movie", "tv", "all"]).optional(),
      })
      .parse(req.query);

    if (!ctx.seerr.listRequests) {
      return { items: [], total: 0 };
    }

    return ctx.seerr.listRequests({
      take: query.take ?? 25,
      skip: query.skip ?? 0,
      filter: query.filter,
      mediaType: query.mediaType,
    });
  });

  app.post("/api/request", async (req) => {
    const { userContext } = await requireAuth(req);
    const body = z
      .object({
        identity: MediaIdentitySchema,
        seasons: z.union([z.array(z.number().int().positive()), z.literal("all")]).optional(),
        is4k: z.boolean().optional(),
      })
      .parse(req.body);

    const { identity } = body;
    if (
      typeof identity.tmdbId !== "number" ||
      (identity.mediaType !== "movie" && identity.mediaType !== "tv")
    ) {
      const err = new Error("Request requires tmdbId and movie/tv mediaType") as Error & {
        statusCode: number;
      };
      err.statusCode = 400;
      throw err;
    }

    await ctx.seerr.requestMedia(identity, {
      seasons: body.seasons,
      is4k: body.is4k,
    });

    const resolved = await resolveMediaByTmdb(
      ctx,
      userContext,
      identity.mediaType,
      identity.tmdbId,
    );
    return { ok: true as const, media: resolved?.media ?? null };
  });
}
