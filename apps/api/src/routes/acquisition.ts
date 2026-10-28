import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AcquisitionModeSchema,
  MediaIdentitySchema,
  tmdbLanguageReference,
} from "@reclinarr/shared";
import type { AppContext } from "../context.js";
import { requireFullAccess } from "../plugins/auth.js";

function publicAcquisition<T extends { localPath?: string }>(item: T): Omit<T, "localPath"> {
  const { localPath: _localPath, ...rest } = item;
  return rest;
}

export async function registerAcquisitionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/acquisitions", async (req) => {
    await requireFullAccess(ctx, req);
    return { items: ctx.acquisitions.list().map(publicAcquisition) };
  });

  app.get("/api/acquisitions/:id", async (req) => {
    await requireFullAccess(ctx, req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const item = ctx.acquisitions.get(id);
    if (!item) {
      const err = new Error("Not found") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    return { item: publicAcquisition(item) };
  });

  app.post("/api/acquisitions", async (req) => {
    const { userContext } = await requireFullAccess(ctx, req);
    ctx.lastLibraryUserContext = userContext;
    const body = z
      .object({
        identity: MediaIdentitySchema,
        mode: AcquisitionModeSchema.default("cache"),
        source: z.object({
          provider: z.literal("dispatcharr"),
          movieId: z.number().optional(),
          episodeId: z.number().optional(),
          uuid: z.string().uuid(),
          streamId: z.string().optional(),
          m3uAccountId: z.number().optional(),
        }),
      })
      .parse(req.body);

    // Re-resolve the Dispatcharr source server-side when identity has a TMDb id —
    // never trust a client uuid alone for library promotion paths.
    let source = body.source;
    if (body.identity.tmdbId && ctx.dispatcharr.findVodByTmdb) {
      const kind =
        body.identity.mediaType === "episode"
          ? null
          : body.identity.mediaType === "tv"
            ? "tv"
            : "movie";
      if (kind) {
        const details = ctx.seerr.getDetails
          ? await ctx.seerr.getDetails(kind, body.identity.tmdbId).catch(() => null)
          : null;
        const media = await ctx.dispatcharr
          .findVodByTmdb(body.identity.tmdbId, kind, {
            titleHint: details?.metadata.title,
            yearHint: details?.metadata.year,
            reference: tmdbLanguageReference(details?.metadata),
          })
          .catch(() => null);
        const avail = media?.availability.find((a) => a.provider === "dispatcharr");
        if (avail?.uuid) {
          source = {
            provider: "dispatcharr",
            uuid: avail.uuid,
            streamId: avail.candidates[0]?.streamId ?? source.streamId,
            m3uAccountId: avail.candidates[0]?.m3uAccountId ?? source.m3uAccountId,
            movieId: avail.movieId ?? source.movieId,
            episodeId: avail.episodeId ?? source.episodeId,
          };
        }
      }
    }

    const item = await ctx.acquisitions.start(
      {
        identity: body.identity,
        mode: body.mode,
        source,
      },
      { queued: true },
    );
    return { item: publicAcquisition(item) };
  });

  app.post("/api/acquisitions/:id/cancel", async (req) => {
    await requireFullAccess(ctx, req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const item = await ctx.acquisitions.cancel(id);
    if (!item) {
      const err = new Error("Not found") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    return { item: publicAcquisition(item) };
  });

  app.post("/api/acquisitions/:id/promote", async (req) => {
    const { userContext } = await requireFullAccess(ctx, req);
    ctx.lastLibraryUserContext = userContext;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const item = await ctx.acquisitions.promoteToLibrary(id);
    if (!item) {
      const err = new Error("Not found or file missing") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    return { item: publicAcquisition(item) };
  });
}
