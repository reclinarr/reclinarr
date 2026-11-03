import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DispatcharrProvider, JellyfinProvider } from "@reclinarr/providers";
import { MemoryCache } from "../cache.js";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import { safeProxiedContentType, sandboxProxiedContent } from "../services/media-plane.js";

/**
 * Channel logos are small but take 0.3–0.6 s each from Dispatcharr, and Live TV shows
 * dozens at once, so keep their bytes. Logos for one id rarely change.
 */
const LOGO_TTL_MS = 24 * 60 * 60_000;
const LOGO_CACHE_ENTRIES = 1000;

type CachedLogo = { contentType: string; body: Buffer };

export async function registerImageRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const logos = new MemoryCache(LOGO_CACHE_ENTRIES);

  app.get("/api/images/dispatcharr/logo/:logoId", async (req, reply) => {
    await requireAuth(req);
    const { logoId } = z.object({ logoId: z.coerce.number().int().positive() }).parse(req.params);

    if (ctx.useMocks || !(ctx.dispatcharr instanceof DispatcharrProvider)) {
      return reply.status(404).send({ error: "No logo in mock mode" });
    }

    const key = String(logoId);
    let logo = logos.get<CachedLogo>(key);
    if (!logo) {
      const upstream = await ctx.dispatcharr.openLogo(logoId);
      const contentType = safeProxiedContentType(upstream.headers.get("content-type"), "image");
      if (upstream.status !== 200) {
        reply.status(upstream.status);
        sandboxProxiedContent(reply).header("Content-Type", contentType);
        return reply.send(Buffer.from(await upstream.arrayBuffer()));
      }
      logo = { contentType, body: Buffer.from(await upstream.arrayBuffer()) };
      logos.set(key, logo, LOGO_TTL_MS);
    }

    sandboxProxiedContent(reply).header("Content-Type", logo.contentType);
    reply.header("Cache-Control", "private, max-age=86400");
    return reply.send(logo.body);
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
    sandboxProxiedContent(reply).header(
      "Content-Type",
      safeProxiedContentType(upstream.headers.get("content-type"), "image"),
    );
    reply.header("Cache-Control", "private, max-age=3600");
    if (!upstream.body) {
      return reply.send(Buffer.from(await upstream.arrayBuffer()));
    }
    return reply.send(upstream.body);
  });
}
