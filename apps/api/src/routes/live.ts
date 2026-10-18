import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { formatIptvUpstreamError } from "@reclinarr/shared";
import { DispatcharrProvider } from "@reclinarr/providers";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import { releaseLivePlayback } from "../services/live-playback.js";

export async function registerLiveRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/live/groups", async (req) => {
    await requireAuth(req);
    const groups = await ctx.dispatcharr.listChannelGroups();
    return { items: groups };
  });

  app.get("/api/live/channels", async (req) => {
    const { session } = await requireAuth(req);
    const query = z
      .object({
        groupId: z.string().optional(),
        search: z.string().optional(),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(50),
        favouritesOnly: z
          .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
          .optional()
          .transform((v) => v === "1" || v === "true"),
        sort: z.enum(["number", "name", "name_desc"]).default("number"),
      })
      .parse(req.query);

    const favourites = ctx.liveFavourites.list(session.jellyfinUserId);
    const result = await ctx.dispatcharr.listChannels({
      groupId: query.groupId,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
      favouritesOnly: query.favouritesOnly,
      favouriteUuids: favourites,
      sort: query.sort,
    });
    return { ...result, favourites };
  });

  app.get("/api/live/favourites", async (req) => {
    const { session } = await requireAuth(req);
    return { items: ctx.liveFavourites.list(session.jellyfinUserId) };
  });

  app.post("/api/live/favourites/:uuid/toggle", async (req) => {
    const { session } = await requireAuth(req);
    const { uuid } = z.object({ uuid: z.string().uuid() }).parse(req.params);
    return ctx.liveFavourites.toggle(session.jellyfinUserId, uuid);
  });

  app.post("/api/live/now", async (req) => {
    await requireAuth(req);
    const body = z
      .object({
        channelUuids: z.array(z.string().uuid()).max(80),
      })
      .parse(req.body);
    const items = await ctx.dispatcharr.getNowNext(body.channelUuids);
    return { items };
  });

  app.get("/api/live/guide", async (req) => {
    await requireAuth(req);
    const query = z
      .object({
        start: z.string().min(1).optional(),
        end: z.string().min(1).optional(),
      })
      .parse(req.query);
    const start = query.start ?? new Date(Date.now() - 30 * 60_000).toISOString();
    const end = query.end ?? new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    const items = await ctx.dispatcharr.getGuideWindow({ start, end });
    return { items, start, end };
  });

  /**
   * Client left the player (back / close). Tear down remux + IPTV leases so the
   * single Dispatcharr slot is free for the next tune.
   */
  app.post("/api/live/stop", async (req) => {
    const { session } = await requireAuth(req);
    const body = z
      .object({ uuid: z.string().uuid().optional() })
      .default({})
      .parse(req.body ?? {});
    releaseLivePlayback(ctx, session.id, body.uuid);
    return { ok: true as const };
  });

  app.post("/api/live/play/:uuid", async (req) => {
    const { session } = await requireAuth(req);
    const { uuid } = z.object({ uuid: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        /** Remux MPEG-TS → HLS for AVPlayer (iOS) and web (mpegts.js A/V drift). */
        hls: z.boolean().optional(),
      })
      .default({})
      .parse(req.body ?? {});

    // Drop any prior live tune before opening — max IPTV connections is often 1.
    releaseLivePlayback(ctx, session.id);
    ctx.liveHls.registerViewer(session.id, uuid);

    const channel = (await ctx.dispatcharr.getChannel?.(uuid)) ?? null;
    const ua = String(req.headers["user-agent"] ?? "");
    // Body flag from the app, or auto-detect Apple clients that cannot play MPEG-TS.
    const wantHls =
      body.hls === true ||
      /iPhone|iPad|iPod|CFNetwork|Darwin|AppleCoreMedia|AVPlayer/i.test(ua);

    if (wantHls) {
      if (ctx.useMocks || !(ctx.dispatcharr instanceof DispatcharrProvider)) {
        const source = await ctx.dispatcharr.resolveLivePlayback(uuid);
        if (!source) {
          const err = new Error("Channel not playable") as Error & { statusCode: number };
          err.statusCode = 404;
          throw err;
        }
        return { source, title: channel?.name, channel };
      }
      const provider = ctx.dispatcharr;
      try {
        await ctx.liveHls.ensureReady(uuid, (opts) => provider.openLiveStream(opts));
      } catch (err) {
        releaseLivePlayback(ctx, session.id, uuid);
        const e = err as Error & { statusCode?: number };
        const friendly = formatIptvUpstreamError(e.statusCode ?? 503, e.message) ?? e.message;
        if (e.statusCode) {
          const httpErr = new Error(friendly) as Error & { statusCode: number };
          httpErr.statusCode = e.statusCode;
          throw httpErr;
        }
        throw err;
      }
      return {
        source: {
          provider: "dispatcharr" as const,
          delivery: {
            mode: "proxy" as const,
            url: `/api/playback/dispatcharr/live/${encodeURIComponent(uuid)}/hls/index.m3u8`,
          },
          directPlay: true,
          mimeType: "application/vnd.apple.mpegurl",
          hls: true,
        },
        title: channel?.name,
        channel,
      };
    }

    const source = await ctx.dispatcharr.resolveLivePlayback(uuid);
    if (!source) {
      const err = new Error("Channel not playable") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    return { source, title: channel?.name, channel };
  });
}
