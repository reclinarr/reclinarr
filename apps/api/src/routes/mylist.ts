import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Media } from "@reclinarr/shared";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import { resolveMediaByTmdb } from "../services/media-enrichment.js";
import { parseMyListKey } from "../services/my-list.js";

export async function registerMyListRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/mylist", async (req) => {
    const { session, userContext } = await requireAuth(req);
    const keys = ctx.myList.list(session.jellyfinUserId);
    const items: Media[] = [];
    for (const key of keys) {
      const parsed = parseMyListKey(key);
      if (!parsed) continue;
      const resolved = await resolveMediaByTmdb(
        ctx,
        userContext,
        parsed.mediaType,
        parsed.tmdbId,
      ).catch(() => null);
      if (resolved?.media) items.push(resolved.media);
    }
    return { items, keys };
  });

  app.get("/api/mylist/has", async (req) => {
    const { session } = await requireAuth(req);
    const query = z
      .object({
        type: z.enum(["movie", "tv"]),
        tmdbId: z.coerce.number().int().positive(),
      })
      .parse(req.query);
    return {
      onList: ctx.myList.has(session.jellyfinUserId, query.type, query.tmdbId),
    };
  });

  app.post("/api/mylist/toggle", async (req) => {
    const { session } = await requireAuth(req);
    const body = z
      .object({
        type: z.enum(["movie", "tv"]),
        tmdbId: z.number().int().positive(),
      })
      .parse(req.body);
    return ctx.myList.toggle(session.jellyfinUserId, body.type, body.tmdbId);
  });
}
