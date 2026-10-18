import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DispatcharrProvider, JellyfinProvider } from "@reclinarr/providers";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";

export async function registerImageRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/images/dispatcharr/logo/:logoId", async (req, reply) => {
    await requireAuth(req);
    const { logoId } = z.object({ logoId: z.coerce.number().int().positive() }).parse(req.params);

    if (ctx.useMocks || !(ctx.dispatcharr instanceof DispatcharrProvider)) {
      return reply.status(404).send({ error: "No logo in mock mode" });
    }

    const upstream = await ctx.dispatcharr.openLogo(logoId);
    reply.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) reply.header("Content-Type", ct);
    reply.header("Cache-Control", "private, max-age=3600");
    if (!upstream.body) {
      return reply.send(Buffer.from(await upstream.arrayBuffer()));
    }
    return reply.send(upstream.body);
  });

  app.get("/api/images/jellyfin/:itemId/:imageType", async (req, reply) => {
    const { userContext } = await requireAuth(req);
    const params = z
      .object({
        itemId: z.string().min(1),
        imageType: z.string().min(1),
      })
      .parse(req.params);

    if (ctx.useMocks || !(ctx.jellyfin instanceof JellyfinProvider)) {
      return reply.status(404).send({ error: "No image in mock mode" });
    }

    const resize = z
      .object({
        maxWidth: z.coerce.number().int().positive().max(1920).optional(),
        maxHeight: z.coerce.number().int().positive().max(1080).optional(),
        quality: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(req.query);

    const upstream = await ctx.jellyfin.openImage(
      userContext,
      params.itemId,
      params.imageType,
      resize,
    );
    reply.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) reply.header("Content-Type", ct);
    reply.header("Cache-Control", "private, max-age=3600");
    if (!upstream.body) {
      return reply.send(Buffer.from(await upstream.arrayBuffer()));
    }
    return reply.send(upstream.body);
  });
}
