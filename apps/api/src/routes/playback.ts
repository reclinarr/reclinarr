import type { FastifyInstance, FastifyReply } from "fastify";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  formatIptvUpstreamError,
  MediaIdentitySchema,
  SubtitleTrackSchema,
  toWebVtt,
} from "@reclinarr/shared";
import { DispatcharrProvider, JellyfinProvider } from "@reclinarr/providers";
import type { AppContext } from "../context.js";
import { isDemoSession, requireAuth, requireFullAccess } from "../plugins/auth.js";
import { IptvProgressStore } from "../services/iptv-progress.js";
import { hlsDir, hlsPlaybackReady } from "../services/hls-paths.js";
import { liveHlsReady } from "../services/live-hls.js";
import { releaseLivePlayback } from "../services/live-playback.js";
import {
  mediaPlaneIsNginx,
  sendAccelRedirect,
  upstreamAccelPath,
} from "../services/media-plane.js";
import {
  embedSessionInPlaylist,
  normalizeCacheHlsPlaylist,
  requestPublicOrigin,
  rewriteHlsPlaylist,
} from "../services/jellyfin-hls-rewrite.js";

export async function registerPlaybackRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  const iptvProgress = new IptvProgressStore(ctx.db);
  const nginxPlane = mediaPlaneIsNginx(ctx.config);

  app.post("/api/playback/resolve", async (req) => {
    const { userContext, session } = await requireAuth(req);
    const body = z
      .object({
        identity: MediaIdentitySchema,
        startPositionSeconds: z.number().nonnegative().optional(),
        audioStreamIndex: z.number().int().optional(),
        preferredAudioLanguage: z.string().max(16).optional(),
        /** Client-measured throughput cap (bits/s) from /api/playback/bandwidth-probe. */
        maxStreamingBitrate: z.number().int().positive().max(50_000_000).optional(),
        deviceProfile: z.enum(["web", "ios", "android"]).optional(),
      })
      .parse(req.body);

    // Free the single IPTV connection held by Live HLS before VOD cache/play.
    releaseLivePlayback(ctx, session.id);

    const result = await ctx.playbackResolver.resolve(userContext, body.identity, {
      startPositionSeconds: body.startPositionSeconds,
      audioStreamIndex: body.audioStreamIndex,
      preferredAudioLanguage: body.preferredAudioLanguage,
      maxStreamingBitrate: body.maxStreamingBitrate,
      deviceProfile: body.deviceProfile,
      libraryOnly: isDemoSession(ctx, session),
    });
    if (!result) {
      const err = new Error("No playable source") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    const played =
      result.status === "ready" ? result.source.resolvedIdentity ?? body.identity : body.identity;
    try {
      const freed = ctx.cacheManager.evictWatchedBefore(played);
      if (freed > 0) req.log.info({ freed }, "freed watched episodes from cache");
    } catch (err) {
      req.log.warn({ err }, "watched-episode cache cleanup failed");
    }
    return result;
  });

  /**
   * Timed Range download through the same nginx→Jellyfin hop as HLS segments.
   * The browser measures wall time; Reclinarr only authorizes + X-Accel-Redirects.
   */
  app.get("/api/playback/bandwidth-probe", async (req, reply) => {
    const { userContext } = await requireAuth(req);
    if (ctx.useMocks || !(ctx.jellyfin instanceof JellyfinProvider)) {
      return reply.status(404).send({ error: "Bandwidth probe requires Jellyfin" });
    }
    const query = z
      .object({ itemId: z.string().min(1).optional() })
      .parse(req.query);
    const target = await ctx.jellyfin.resolveBandwidthProbeTarget(
      userContext,
      query.itemId,
    );
    if (nginxPlane) {
      return sendAccelRedirect(reply, upstreamAccelPath("jellyfin", target.url.toString()), {
        buffering: true,
        contentType: "application/octet-stream",
      });
    }
    const abort = new AbortController();
    reply.raw.on("close", () => abort.abort());
    const rangeHeader =
      typeof req.headers.range === "string"
        ? req.headers.range
        : target.headers.Range;
    const res = await fetch(target.url, {
      headers: {
        ...target.headers,
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
      signal: abort.signal,
      redirect: "manual",
    });
    if (!res.ok && res.status !== 206) {
      return reply.status(res.status).send({ error: "Probe upstream failed" });
    }
    reply.status(res.status);
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Cache-Control", "no-store");
    if (!res.body) {
      return reply.send(Buffer.from(await res.arrayBuffer()));
    }
    return reply.send(res.body);
  });

  /** Async subtitle enrichment — does not block Play resolve. */
  app.post("/api/playback/subtitles", async (req) => {
    const { userContext } = await requireAuth(req);
    const body = z
      .object({
        identity: MediaIdentitySchema,
        existing: z.array(SubtitleTrackSchema).optional(),
        provider: z.enum(["jellyfin", "cache", "dispatcharr"]).optional(),
      })
      .parse(req.body);

    const subtitles = await ctx.playbackResolver.listSubtitles(
      userContext,
      body.identity,
      { existing: body.existing, provider: body.provider },
    );
    return { subtitles };
  });

  /**
   * Jellyfin progress — write-through via Reclinarr SQLite, then async fan-out
   * to Jellyfin Sessions/UserData. The player is never blocked on Jellyfin.
   */
  app.post("/api/playback/progress", async (req) => {
    const { userContext, session } = await requireAuth(req);
    const body = z
      .object({
        itemId: z.string().min(1),
        positionSeconds: z.number().nonnegative(),
        isPaused: z.boolean().optional(),
        playSessionId: z.string().optional(),
        mediaSourceId: z.string().optional(),
        playMethod: z.enum(["DirectPlay", "DirectStream", "Transcode"]).optional(),
        event: z.enum(["start", "progress", "stopped"]),
        identity: MediaIdentitySchema.optional(),
        durationSeconds: z.number().nonnegative().optional(),
        title: z.string().optional(),
      })
      .parse(req.body);

    const identity = {
      mediaType: body.identity?.mediaType ?? ("other" as const),
      tmdbId: body.identity?.tmdbId,
      seasonNumber: body.identity?.seasonNumber,
      episodeNumber: body.identity?.episodeNumber,
      jellyfinItemId: body.identity?.jellyfinItemId ?? body.itemId,
    };
    const duration = body.durationSeconds;
    const completed =
      duration !== undefined &&
      duration > 0 &&
      body.positionSeconds / duration >= 0.9;

    iptvProgress.upsert(session.jellyfinUserId, {
      identity,
      provider: "jellyfin",
      positionSeconds: body.positionSeconds,
      durationSeconds: duration,
      title: body.title,
      completed,
      preserveHigherPosition: body.event === "start" || body.positionSeconds < 5,
    });

    // Fan-out: best-effort, never await — Jellyfin latency/500s must not stall Play.
    void Promise.resolve()
      .then(() => ctx.jellyfin.reportProgress(userContext, body))
      .catch((err) => {
        req.log.debug({ err }, "jellyfin progress fan-out failed");
      });

    return { ok: true };
  });

  /** Persist IPTV / cache watch position for Continue Watching. */
  app.post("/api/playback/iptv-progress", async (req) => {
    const { session } = await requireAuth(req);
    const body = z
      .object({
        identity: MediaIdentitySchema,
        positionSeconds: z.number().nonnegative(),
        durationSeconds: z.number().nonnegative().optional(),
        event: z.enum(["start", "progress", "stopped"]).default("progress"),
        title: z.string().optional(),
      })
      .parse(req.body);

    const duration = body.durationSeconds;
    const completed =
      duration !== undefined &&
      duration > 0 &&
      body.positionSeconds / duration >= 0.9;

    iptvProgress.upsert(session.jellyfinUserId, {
      identity: body.identity,
      provider: "dispatcharr",
      positionSeconds: body.positionSeconds,
      durationSeconds: duration,
      title: body.title,
      completed,
      // "start" at 0 must not wipe a saved Continue Watching position.
      preserveHigherPosition: body.event === "start" || body.positionSeconds < 5,
    });
    return { ok: true };
  });

  app.get("/api/playback/jellyfin/stream/:itemId", async (req, reply) => {
    const { userContext } = await requireAuth(req);
    const params = z.object({ itemId: z.string().min(1) }).parse(req.params);
    const query = z
      .object({
        mediaSourceId: z.string().min(1),
        playMethod: z.enum(["DirectPlay", "DirectStream", "Transcode"]).optional(),
        playSessionId: z.string().optional(),
        audioStreamIndex: z.coerce.number().optional(),
        transcodingPath: z.string().optional(),
      })
      .parse(req.query);

    if (ctx.useMocks || !(ctx.jellyfin instanceof JellyfinProvider)) {
      reply.header("Content-Type", "text/plain");
      return reply.send("Mock stream — configure JELLYFIN_URL for real playback.");
    }

    if (query.transcodingPath) {
      const path = query.transcodingPath;
      if (path.includes("://") || path.includes("..")) {
        return reply.status(400).send({ error: "Invalid transcoding path" });
      }
    }

    const target = ctx.jellyfin.resolveStreamTarget(userContext, params.itemId, {
      mediaSourceId: query.mediaSourceId,
      playMethod: query.playMethod,
      playSessionId: query.playSessionId,
      audioStreamIndex: query.audioStreamIndex,
      transcodingPath: query.transcodingPath,
    });

    // HLS master playlist stays in the API (rewrite segment URLs); media bytes go via nginx.
    // Progressive Transcode (stream.mp4 / http) is NOT a playlist — only .m3u8 is. transcodingPath
    // is ignored unless playMethod=Transcode, and only its path (not query) names a playlist.
    const looksLikePlaylist =
      query.playMethod === "Transcode" && isPlaylistPath(query.transcodingPath ?? "");

    if (nginxPlane && !looksLikePlaylist) {
      return sendAccelRedirect(reply, upstreamAccelPath("jellyfin", target.url.toString()), {
        buffering: false,
      });
    }

    const abort = new AbortController();
    reply.raw.on("close", () => abort.abort());
    const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : undefined;

    const upstream = await ctx.jellyfin.openStream(userContext, params.itemId, {
      mediaSourceId: query.mediaSourceId,
      playMethod: query.playMethod,
      playSessionId: query.playSessionId,
      audioStreamIndex: query.audioStreamIndex,
      transcodingPath: query.transcodingPath,
      range: rangeHeader,
      signal: abort.signal,
    });

    const ct = upstream.headers.get("content-type") ?? "";
    if (isPlaylistContentType(ct)) {
      const text = await readPlaylistText(upstream, abort);
      const rewritten = rewriteHlsPlaylist(text, {
        ...query,
        sessionId: req.session?.id,
        publicOrigin: requestPublicOrigin(req, ctx.config.RECLINARR_PUBLIC_URL),
      });
      reply.header("Content-Type", "application/vnd.apple.mpegurl");
      reply.header("Cache-Control", "no-cache");
      return reply.send(rewritten);
    }

    if (nginxPlane) {
      return sendAccelRedirect(reply, upstreamAccelPath("jellyfin", target.url.toString()), {
        buffering: false,
        contentType: ct || undefined,
      });
    }

    reply.status(upstream.status);
    if (ct) reply.header("Content-Type", ct);
    const cl = upstream.headers.get("content-length");
    if (cl) reply.header("Content-Length", cl);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) reply.header("Content-Range", contentRange);
    const acceptRanges = upstream.headers.get("accept-ranges");
    if (acceptRanges) reply.header("Accept-Ranges", acceptRanges);

    if (!upstream.body) {
      return reply.send(Buffer.from(await upstream.arrayBuffer()));
    }
    return reply.send(upstream.body);
  });

  /**
   * Serve HLS playlist/segments for a local acquisition cache.
   * Always stream from Node (same as live HLS segments). Local files under
   * RECLINARR_DATA_DIR are often mode 600 from ffmpeg; nginx's `/_hls` alias
   * then 403s and AVPlayer reports "permission to access the requested resource".
   */
  const sendCacheHls = async (
    req: { session?: { id: string } },
    reply: FastifyReply,
    id: string,
    relative: string,
  ) => {
    const clean = relative
      .replace(/\.\./g, "")
      .replace(/^\/+/, "")
      .replace(/\/+/g, "/");
    if (!clean) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const job = ctx.acquisitions.get(id);
    if (!job) return reply.status(404).send({ error: "Cache not found" });
    ctx.cacheManager.touch(id);

    const filePath = join(hlsDir(ctx.config.RECLINARR_DATA_DIR, id), clean);
    if (!existsSync(filePath)) {
      if (!hlsPlaybackReady(ctx.config.RECLINARR_DATA_DIR, id)) {
        return reply.status(404).send({ error: "HLS not ready" });
      }
      return reply.status(404).send({ error: "Segment not found" });
    }

    // Playlists must embed session on every segment URI — AVPlayer drops headers.
    if (clean.endsWith(".m3u8")) {
      const raw = normalizeCacheHlsPlaylist(readFileSync(filePath, "utf8"));
      const body = req.session?.id ? embedSessionInPlaylist(raw, req.session.id) : raw;
      reply.header("Content-Type", contentTypeForHls(clean));
      reply.header("Cache-Control", "no-cache");
      return reply.send(body);
    }

    const st = statSync(filePath);
    reply.header("Content-Type", contentTypeForHls(clean));
    reply.header("Content-Length", String(st.size));
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(createReadStream(filePath));
  };

  app.get("/api/playback/cache/:id/hls/index.m3u8", async (req, reply) => {
    await requireFullAccess(ctx, req);
    const { id } = z.object({ id: z.guid() }).parse(req.params);
    return sendCacheHls(req, reply, id, "index.m3u8");
  });

  app.get("/api/playback/cache/:id/hls/:segment", async (req, reply) => {
    await requireFullAccess(ctx, req);
    const params = z
      .object({
        id: z.guid(),
        segment: z.string().min(1).regex(/^[\w.-]+$/),
      })
      .parse(req.params);
    return sendCacheHls(req, reply, params.id, params.segment);
  });

  /** Legacy cache URL → HLS playlist (bookmarks / old clients). */
  app.get("/api/playback/cache/:id", async (req, reply) => {
    await requireFullAccess(ctx, req);
    const { id } = z.object({ id: z.guid() }).parse(req.params);
    if (!hlsPlaybackReady(ctx.config.RECLINARR_DATA_DIR, id)) {
      return reply.status(404).send({ error: "Cache HLS not ready" });
    }
    return reply.redirect(`/api/playback/cache/${id}/hls/index.m3u8`);
  });

  /**
   * Proxies Dispatcharr live MPEG-TS using Reclinarr-held auth.
   * nginx media plane: X-Accel-Redirect; node plane: pipe the body.
   */
  app.get("/api/playback/dispatcharr/live/:uuid", async (req, reply) => {
    const { session } = await requireAuth(req);
    const params = z.object({ uuid: z.guid() }).parse(req.params);
    if (!ctx.liveHls.heartbeat(session.id, params.uuid)) {
      return reply.status(409).send({ error: "Channel is no longer selected" });
    }

    if (ctx.useMocks || !(ctx.dispatcharr instanceof DispatcharrProvider)) {
      reply.header("Content-Type", "text/plain");
      return reply.send("Mock live stream — configure DISPATCHARR auth for real playback.");
    }

    try {
      if (nginxPlane) {
        // API returns 204 immediately; nginx keeps Dispatcharr open. Hold the live
        // slot until another channel is tuned (see holdLive).
        ctx.iptvConnections.holdLive(params.uuid);
        const target = await ctx.dispatcharr.resolveLiveStreamTarget({ uuid: params.uuid });
        return sendAccelRedirect(reply, upstreamAccelPath("dispatcharr", target.url), {
          contentType: "video/mp2t",
          buffering: false,
        });
      }

      const lease = ctx.iptvConnections.acquire("live", { label: `live:${params.uuid}` });
      const cleanup = () => lease.release();
      reply.raw.on("close", cleanup);

      const upstream = await ctx.dispatcharr.openLiveStream({
        uuid: params.uuid,
        signal: lease.signal,
      });
      if (!upstream.ok) {
        cleanup();
        const errText = await upstream.text().catch(() => "");
        return reply.status(upstream.status).send({
          error:
            formatIptvUpstreamError(upstream.status, errText) ??
            (errText || `Dispatcharr live stream failed (${upstream.status})`),
        });
      }

      reply.status(upstream.status);
      reply.header("Content-Type", upstream.headers.get("content-type") ?? "video/mp2t");
      reply.header("Cache-Control", "no-store, no-transform");
      reply.header("X-Accel-Buffering", "no");
      if (!upstream.body) {
        cleanup();
        return reply.send(Buffer.from(await upstream.arrayBuffer()));
      }
      // Do not cancel() the body on lease abort — once reply.send() pipes it the
      // stream is locked and cancel() crashes the process (ERR_INVALID_STATE).
      // Aborting lease.signal cancels the upstream fetch instead.
      return reply.send(upstream.body);
    } catch (err) {
      throw err;
    }
  });

  /**
   * Live HLS remux (MPEG-TS → sliding window) for AVPlayer / iOS.
   * Session is started by POST /api/live/play/:uuid with { hls: true }.
   */
  app.get("/api/playback/dispatcharr/live/:uuid/hls/index.m3u8", async (req, reply) => {
    const { session } = await requireAuth(req);
    const { uuid } = z.object({ uuid: z.guid() }).parse(req.params);
    // hls.js / AVPlayer poll the playlist every few seconds, which doubles as the viewer heartbeat.
    if (!ctx.liveHls.heartbeat(session.id, uuid)) {
      return reply.status(409).send({ error: "Channel is no longer selected" });
    }

    if (ctx.useMocks || !(ctx.dispatcharr instanceof DispatcharrProvider)) {
      return reply.status(404).send({ error: "Live HLS requires Dispatcharr" });
    }

    const provider = ctx.dispatcharr;
    // Playlist polls are frequent — only call ensureReady when the window is missing.
    // Re-entering ensureReady on every hls.js reload was stacking hundreds of awaits.
    if (!liveHlsReady(ctx.config.RECLINARR_DATA_DIR, uuid)) {
      try {
        await ctx.liveHls.ensureReady(uuid, (opts) => provider.openLiveStream(opts));
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        return reply.status(e.statusCode ?? 502).send({ error: e.message });
      }
    }

    const filePath = ctx.liveHls.filePath(uuid, "index.m3u8");
    if (!filePath || !existsSync(filePath) || !liveHlsReady(ctx.config.RECLINARR_DATA_DIR, uuid)) {
      return reply.status(404).send({ error: "Live HLS not ready" });
    }

    ctx.liveHls.touch(uuid);
    const raw = readFileSync(filePath, "utf8");
    const sessionId = req.session?.id;
    // Keep segments relative to the playlist URL (already absolute via playbackMediaUrl).
    // Absolute rewrites + Host mismatches have caused AVPlayer "resource unavailable".
    const body = sessionId ? embedSessionInPlaylist(raw, sessionId) : raw;

    reply.header("Content-Type", "application/vnd.apple.mpegurl");
    reply.header("Cache-Control", "no-cache");
    reply.header("Access-Control-Allow-Origin", "*");
    return reply.send(body);
  });

  app.get("/api/playback/dispatcharr/live/:uuid/hls/:segment", async (req, reply) => {
    await requireAuth(req);
    const params = z
      .object({
        uuid: z.guid(),
        segment: z.string().min(1).regex(/^[\w.-]+$/),
      })
      .parse(req.params);

    ctx.liveHls.touch(params.uuid);
    const filePath = ctx.liveHls.filePath(params.uuid, params.segment);
    if (!filePath || !existsSync(filePath)) {
      return reply.status(404).send({ error: "Segment not found" });
    }

    const st = statSync(filePath);
    reply.header("Content-Type", contentTypeForHls(params.segment));
    reply.header("Content-Length", String(st.size));
    reply.header("Cache-Control", "no-store");
    return reply.send(createReadStream(filePath));
  });

  /**
   * Debug / raw Dispatcharr VOD proxy (no remux). Normal Play uses auto-cache + HLS.
   */
  app.get("/api/playback/dispatcharr/vod/:uuid", async (req, reply) => {
    await requireFullAccess(ctx, req);
    const params = z.object({ uuid: z.guid() }).parse(req.params);
    const query = z
      .object({
        kind: z.enum(["movie", "episode"]).default("movie"),
        streamId: z.string().optional(),
        raw: z
          .enum(["0", "1", "true", "false"])
          .optional()
          .transform((v) => v === "1" || v === "true"),
      })
      .parse(req.query);

    if (ctx.useMocks || !(ctx.dispatcharr instanceof DispatcharrProvider)) {
      reply.header("Content-Type", "text/plain");
      return reply.send("Mock Dispatcharr stream — configure DISPATCHARR auth for real playback.");
    }

    if (!query.raw) {
      return reply.status(400).send({
        error: "Direct IPTV VOD remux is retired — use Play (auto-cache HLS) or ?raw=1 for debug",
      });
    }

    try {
      if (nginxPlane) {
        // Debug raw VOD via nginx: lease until preempted (API returns 204 immediately).
        ctx.iptvConnections.acquire("playback", { label: `vod:${params.uuid}` });
        const target = await ctx.dispatcharr.resolveVodStreamTarget({
          uuid: params.uuid,
          kind: query.kind,
          streamId: query.streamId,
        });
        return sendAccelRedirect(reply, upstreamAccelPath("dispatcharr", target.url), {
          buffering: false,
        });
      }

      const lease = ctx.iptvConnections.acquire("playback", {
        label: `vod:${params.uuid}`,
      });
      const cleanup = () => lease.release();
      reply.raw.on("close", cleanup);

      const upstream = await ctx.dispatcharr.openVodStream({
        uuid: params.uuid,
        kind: query.kind,
        streamId: query.streamId,
        signal: lease.signal,
      });

      if (!upstream.ok) {
        cleanup();
        const errText = await upstream.text().catch(() => "");
        return reply.status(upstream.status).send({
          error:
            formatIptvUpstreamError(upstream.status, errText) ??
            (errText || `Dispatcharr stream failed (${upstream.status})`),
        });
      }

      reply.status(upstream.status);
      reply.header("Cache-Control", "no-store");
      const ct = upstream.headers.get("content-type");
      if (ct) reply.header("Content-Type", ct);
      if (!upstream.body) {
        cleanup();
        return reply.send(Buffer.from(await upstream.arrayBuffer()));
      }
      return reply.send(upstream.body);
    } catch (err) {
      throw err;
    }
  });

  /** Text subtitles Jellyfin already indexed (including Bazarr sidecars). */
  app.get("/api/playback/jellyfin/subtitle/:itemId/:index", async (req, reply) => {
    const { userContext } = await requireAuth(req);
    const params = z
      .object({
        itemId: z.string().min(1),
        index: z.coerce.number().int().nonnegative(),
      })
      .parse(req.params);
    const query = z.object({ mediaSourceId: z.string().min(1) }).parse(req.query);

    if (ctx.useMocks || !(ctx.jellyfin instanceof JellyfinProvider)) {
      return reply.status(404).send({ error: "Subtitles are not available in mock mode" });
    }

    const upstream = await ctx.jellyfin.openSubtitle(
      userContext,
      params.itemId,
      query.mediaSourceId,
      params.index,
    );
    const text = await upstream.text();
    reply.header("Content-Type", "text/vtt; charset=utf-8");
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(toWebVtt(text));
  });

  app.get("/api/playback/bazarr/movie/:id/:index", async (req, reply) => {
    await requireAuth(req);
    const params = z
      .object({
        id: z.coerce.number().int().positive(),
        index: z.coerce.number().int().nonnegative(),
      })
      .parse(req.params);
    return sendBazarrSubtitle(ctx, reply, "movie", params.id, params.index);
  });

  app.get("/api/playback/bazarr/episode/:seriesId/:id/:index", async (req, reply) => {
    await requireAuth(req);
    const params = z
      .object({
        seriesId: z.coerce.number().int().positive(),
        id: z.coerce.number().int().positive(),
        index: z.coerce.number().int().nonnegative(),
      })
      .parse(req.params);
    return sendBazarrSubtitle(ctx, reply, "episode", params.id, params.index, params.seriesId);
  });

  /** Proxies HLS segments / nested playlists from Jellyfin. */
  app.get("/api/playback/jellyfin/hls", async (req, reply) => {
    const { userContext } = await requireAuth(req);
    const query = z.object({ path: z.string().min(1) }).parse(req.query);

    if (ctx.useMocks || !(ctx.jellyfin instanceof JellyfinProvider)) {
      return reply.status(404).send({ error: "Not available in mock mode" });
    }

    const path = query.path;
    if (path.includes("://") || path.includes("..")) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const target = ctx.jellyfin.resolveStreamTarget(userContext, "hls", {
      mediaSourceId: "hls",
      jellyfinPath: path.startsWith("/") ? path : `/${path}`,
    });

    if (nginxPlane && !isPlaylistPath(path)) {
      return sendAccelRedirect(reply, upstreamAccelPath("jellyfin", target.url.toString()), {
        buffering: false,
      });
    }

    const abort = new AbortController();
    reply.raw.on("close", () => abort.abort());
    const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : undefined;

    const upstream = await ctx.jellyfin.openStream(userContext, "hls", {
      mediaSourceId: "hls",
      jellyfinPath: path.startsWith("/") ? path : `/${path}`,
      range: rangeHeader,
      signal: abort.signal,
    });

    const ct = upstream.headers.get("content-type") ?? "";
    if (isPlaylistContentType(ct)) {
      const text = await readPlaylistText(upstream, abort);
      const rewritten = rewriteHlsPlaylist(text, {
        path,
        sessionId: req.session?.id,
        publicOrigin: requestPublicOrigin(req, ctx.config.RECLINARR_PUBLIC_URL),
      });
      reply.header("Content-Type", "application/vnd.apple.mpegurl");
      reply.header("Cache-Control", "no-cache");
      return reply.send(rewritten);
    }

    if (nginxPlane) {
      return sendAccelRedirect(reply, upstreamAccelPath("jellyfin", target.url.toString()), {
        buffering: false,
        contentType: ct || undefined,
      });
    }

    reply.status(upstream.status);
    if (ct) reply.header("Content-Type", ct);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) reply.header("Content-Range", contentRange);
    if (!upstream.body) {
      return reply.send(Buffer.from(await upstream.arrayBuffer()));
    }
    return reply.send(upstream.body);
  });
}

/** A Jellyfin path names an HLS playlist only by its path; a ".m3u8" in the query must not count. */
export function isPlaylistPath(pathAndQuery: string): boolean {
  return pathAndQuery.split(/[?#]/, 1)[0]!.toLowerCase().endsWith(".m3u8");
}

function isPlaylistContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes("mpegurl") || ct.includes("m3u8");
}

/** Real HLS playlists are a few KB; anything this large is media mislabelled as a playlist. */
export const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;

/** Reads a playlist body into memory, refusing (and aborting the upstream) past MAX_PLAYLIST_BYTES. */
export async function readPlaylistText(upstream: Response, abort: AbortController): Promise<string> {
  const declared = Number(upstream.headers.get("content-length") ?? "");
  const tooLarge = () => {
    abort.abort();
    return Object.assign(new Error("Upstream playlist is too large"), { statusCode: 502 });
  };
  if (Number.isFinite(declared) && declared > MAX_PLAYLIST_BYTES) throw tooLarge();
  if (!upstream.body) return "";
  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PLAYLIST_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function sendBazarrSubtitle(
  ctx: AppContext,
  reply: FastifyReply,
  kind: "movie" | "episode",
  mediaId: number,
  index: number,
  seriesId?: number,
) {
  if (!ctx.bazarr.isConfigured()) {
    return reply.status(404).send({ error: "Bazarr is not configured" });
  }
  const file = await ctx.bazarr.readSubtitle(kind, mediaId, index, seriesId);
  if (!file) return reply.status(404).send({ error: "Subtitle not found" });
  reply.header("Content-Type", "text/vtt; charset=utf-8");
  reply.header("Cache-Control", "private, max-age=3600");
  return reply.send(toWebVtt(file));
}

function contentTypeForHls(relative: string): string {
  if (relative.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (relative.endsWith(".m4s") || relative.endsWith(".mp4")) return "video/mp4";
  return "video/mp2t";
}
