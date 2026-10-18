import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolvePreferredAction, type Media } from "@reclinarr/shared";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import {
  resolveMediaAvailabilityByTmdb,
  resolveMediaByTmdb,
} from "../services/media-enrichment.js";
import { mergeSeriesEpisodes } from "../services/series-episodes.js";
import { pickResumeEpisode } from "../services/pick-resume-episode.js";

export async function registerMediaRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/media/jellyfin/:itemId", async (req) => {
    const { userContext } = await requireAuth(req);
    const { itemId } = z.object({ itemId: z.string().min(1) }).parse(req.params);
    const media = await ctx.jellyfin.getByJellyfinItemId(userContext, itemId);
    if (!media) {
      const err = new Error("Not found") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }

    // Enrich with Seerr request state when TMDb is known
    if (
      media.identity.tmdbId &&
      (media.identity.mediaType === "movie" || media.identity.mediaType === "tv")
    ) {
      const seerrAvail = await ctx.seerr
        .getRequestAvailability({
          tmdbId: media.identity.tmdbId,
          mediaType: media.identity.mediaType,
        })
        .catch(() => null);
      if (seerrAvail) {
        const availability = [
          ...media.availability.filter((a) => a.provider !== "seerr"),
          seerrAvail,
        ];
        return {
          media: {
            ...media,
            availability,
            preferredAction: resolvePreferredAction(availability),
          },
        };
      }
    }

    return { media };
  });

  // More specific than /api/media/:type/:tmdbId — register first.
  app.get("/api/media/:type/:tmdbId/similar", async (req) => {
    await requireAuth(req);
    const params = z
      .object({
        type: z.enum(["movie", "tv"]),
        tmdbId: z.coerce.number().int().positive(),
      })
      .parse(req.params);
    const discovery = ctx.seerr as import("@reclinarr/providers").DiscoveryProvider;
    const items = discovery.getSimilar
      ? await discovery.getSimilar(params.type, params.tmdbId).catch(() => [])
      : [];
    const { enrichDiscoveryRow } = await import("../services/media-enrichment.js");
    return { items: enrichDiscoveryRow(ctx, items) };
  });

  app.get("/api/media/:type/:tmdbId/availability", async (req) => {
    const { userContext } = await requireAuth(req);
    const params = z
      .object({
        type: z.enum(["movie", "tv"]),
        tmdbId: z.coerce.number().int().positive(),
      })
      .parse(req.params);

    const media = await resolveMediaAvailabilityByTmdb(
      ctx,
      userContext,
      params.type,
      params.tmdbId,
    );
    if (!media) {
      const err = new Error("Not found") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    return { media };
  });

  app.get("/api/media/:type/:tmdbId", async (req) => {
    const { userContext } = await requireAuth(req);
    const params = z
      .object({
        type: z.enum(["movie", "tv"]),
        tmdbId: z.coerce.number().int().positive(),
      })
      .parse(req.params);

    const resolved = await resolveMediaByTmdb(ctx, userContext, params.type, params.tmdbId);
    if (!resolved) {
      const err = new Error("Not found") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    return {
      media: resolved.media,
      iptvResolvePending: resolved.iptvResolvePending,
    };
  });

  /** Episode guide from Seerr, with Jellyfin and IPTV VOD playability overlaid per episode. */
  app.get("/api/media/tv/:tmdbId/episodes", async (req) => {
    const { userContext, session } = await requireAuth(req);
    const { tmdbId } = z
      .object({ tmdbId: z.coerce.number().int().positive() })
      .parse(req.params);

    const resolved = await resolveMediaByTmdb(ctx, userContext, "tv", tmdbId);
    if (!resolved) {
      const err = new Error("Series not found") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    const series = resolved.media;

    const dispatcharrSeriesId = series.availability.find(
      (a) => a.provider === "dispatcharr",
    )?.seriesId;
    const jellyfinSeriesId =
      series.identity.jellyfinItemId ??
      series.availability.find((a) => a.provider === "jellyfin")?.itemId;

    const [guide, dispatcharrEpisodes, jellyfinEpisodes] = await Promise.all([
      ctx.seerr.listTvEpisodes(tmdbId).catch(() => [] as Media[]),
      dispatcharrSeriesId && ctx.dispatcharr.listEpisodesForSeries
        ? ctx.dispatcharr
            .listEpisodesForSeries(dispatcharrSeriesId, { seriesTmdbId: tmdbId })
            .catch(() => [] as Media[])
        : Promise.resolve([] as Media[]),
      jellyfinSeriesId && ctx.jellyfin.listEpisodesForSeries
        ? ctx.jellyfin.listEpisodesForSeries(userContext, jellyfinSeriesId).catch(() => [] as Media[])
        : Promise.resolve([] as Media[]),
    ]);

    const { seasons, items: merged } = mergeSeriesEpisodes(
      tmdbId,
      { guide, jellyfin: jellyfinEpisodes, iptv: dispatcharrEpisodes },
      (identity) =>
        ctx.acquisitions.cacheAvailabilityFor({
          tmdbId,
          mediaType: "episode",
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
          ...(identity.jellyfinItemId ? { jellyfinItemId: identity.jellyfinItemId } : {}),
        }),
      // Local library series → never stream that show via IPTV.
      { suppressIptv: Boolean(jellyfinSeriesId) },
    );

    // Attach IPTV watch progress so series details can show Resume.
    const iptvResumes = ctx.iptvProgress.listInProgressForSeries(session.jellyfinUserId, tmdbId);
    const resumeByKey = new Map(
      iptvResumes.map((r) => [`${r.seasonNumber}:${r.episodeNumber}`, r] as const),
    );
    const items = merged.map((ep) => {
      const resume = resumeByKey.get(`${ep.seasonNumber}:${ep.episodeNumber}`);
      if (!resume) return ep;
      const hasProgress = ep.availability.some(
        (a) =>
          "positionSeconds" in a &&
          typeof a.positionSeconds === "number" &&
          a.positionSeconds > 30,
      );
      if (hasProgress) return ep;
      const availability = [
        ...ep.availability.filter((a) => a.provider !== "dispatcharr"),
        {
          ...(ep.availability.find((a) => a.provider === "dispatcharr") ?? {
            provider: "dispatcharr" as const,
            available: true,
            canPlay: true,
            candidates: [],
          }),
          positionSeconds: resume.positionSeconds,
          ...(resume.durationSeconds != null
            ? { durationSeconds: resume.durationSeconds }
            : {}),
        },
      ];
      return {
        ...ep,
        availability,
        preferredAction: resolvePreferredAction(availability),
      };
    });

    const resumeCandidates = [
      ...iptvResumes.map((r) => ({
        seasonNumber: r.seasonNumber,
        episodeNumber: r.episodeNumber,
        positionSeconds: r.positionSeconds,
        durationSeconds: r.durationSeconds,
        updatedAtMs: r.updatedAtMs,
      })),
      ...items.flatMap((ep) => {
        const hits: Array<{
          seasonNumber: number;
          episodeNumber: number;
          positionSeconds: number;
          durationSeconds?: number;
          updatedAtMs: number;
        }> = [];
        for (const a of ep.availability) {
          if (
            !("positionSeconds" in a) ||
            typeof a.positionSeconds !== "number" ||
            a.positionSeconds <= 30
          ) {
            continue;
          }
          const lastPlayedAt =
            a.provider === "jellyfin" && "lastPlayedAt" in a && typeof a.lastPlayedAt === "string"
              ? Date.parse(a.lastPlayedAt)
              : NaN;
          hits.push({
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
            positionSeconds: a.positionSeconds,
            durationSeconds:
              "durationSeconds" in a && typeof a.durationSeconds === "number"
                ? a.durationSeconds
                : undefined,
            // Prefer a real last-played timestamp; otherwise treat as older than SQLite rows.
            updatedAtMs: Number.isFinite(lastPlayedAt) ? lastPlayedAt : 0,
          });
        }
        return hits;
      }),
    ];

    return {
      series,
      seasons,
      items,
      /** Most recently watched in-progress episode, if any. */
      resumeEpisode: pickResumeEpisode(resumeCandidates),
    };
  });
}
