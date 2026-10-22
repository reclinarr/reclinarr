import type { FastifyInstance } from "fastify";
import type { Media, TmdbLanguageReference } from "@reclinarr/shared";
import { resolvePreferredAction, tmdbLanguageReference } from "@reclinarr/shared";
import type { DiscoveryProvider, UserContext } from "@reclinarr/providers";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import { jellyfinTmdbIndex } from "../db/schema.js";
import { IptvProgressStore } from "../services/iptv-progress.js";
import { buildHomeDiscoveryRails } from "../services/catalog-rails.js";
import { applyTmdbArtwork, resolveMediaByTmdb } from "../services/media-enrichment.js";
import { continueSeriesKey, hydrateContinueWatching } from "../services/home-continue.js";

/** Prefer a real next episode from Dispatcharr/Jellyfin catalogues (handles season wrap). */
async function refineIptvNextUp(
  ctx: AppContext,
  userContext: UserContext,
  items: Media[],
): Promise<Media[]> {
  const out: Media[] = [];
  for (const item of items) {
    const tmdbId = item.identity.tmdbId;
    const season = item.identity.seasonNumber;
    const episode = item.identity.episodeNumber;
    if (tmdbId == null || season == null || episode == null) {
      out.push(item);
      continue;
    }
    // listNextUp already computed episode+1 — try that, then season+1 E1.
    const candidates = [
      { seasonNumber: season, episodeNumber: episode },
      { seasonNumber: season + 1, episodeNumber: 1 },
    ];
    let resolved: Media | null = null;
    const dispatcharr = ctx.dispatcharr as {
      findEpisodeBySeriesTmdb?: (
        seriesTmdbId: number,
        seasonNumber: number,
        episodeNumber: number,
        opts?: { titleHint?: string; reference?: TmdbLanguageReference },
      ) => Promise<Media | null>;
    };
    const seriesDetails = dispatcharr.findEpisodeBySeriesTmdb && ctx.seerr.getDetails
      ? await ctx.seerr.getDetails("tv", tmdbId).catch(() => null)
      : null;
    for (const c of candidates) {
      if (dispatcharr.findEpisodeBySeriesTmdb) {
        resolved = await dispatcharr
          .findEpisodeBySeriesTmdb(tmdbId, c.seasonNumber, c.episodeNumber, {
            titleHint:
              seriesDetails?.metadata.title ??
              item.metadata.title?.replace(/\s*S\d+E\d+\s*$/i, "").trim(),
            reference: tmdbLanguageReference(seriesDetails?.metadata),
          })
          .catch(() => null);
        if (resolved) break;
      }
      if (!resolved && ctx.jellyfin.listEpisodesForSeries) {
        const series = await ctx.jellyfin.findByTmdb(userContext, tmdbId, "tv").catch(() => null);
        const seriesId = series?.identity.jellyfinItemId;
        if (seriesId) {
          const eps = await ctx.jellyfin
            .listEpisodesForSeries(userContext, seriesId)
            .catch(() => []);
          const hit = eps.find(
            (e) =>
              e.identity.seasonNumber === c.seasonNumber &&
              e.identity.episodeNumber === c.episodeNumber,
          );
          if (hit) {
            resolved = hit;
            break;
          }
        }
      }
    }
    if (!resolved) continue; // drop suggestions that do not exist
    const availability = [
      ...resolved.availability,
      {
        provider: "dispatcharr" as const,
        available: true,
        canPlay: true,
        candidates: [],
      },
    ];
    out.push({
      ...resolved,
      availability,
      preferredAction: resolvePreferredAction(availability),
      metadata: {
        ...resolved.metadata,
        posterUrl: resolved.metadata.posterUrl ?? item.metadata.posterUrl,
      },
    });
  }
  return out;
}

export async function registerHomeRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const iptvProgress = new IptvProgressStore(ctx.db);

  app.get("/api/home", async (req) => {
    const { userContext, session } = await requireAuth(req);

    const [continueWatching, nextUp, recentlyAdded, discoveryRails] = await Promise.all([
      ctx.jellyfin.getContinueWatching(userContext).catch(() => []),
      ctx.jellyfin.getNextUp(userContext).catch(() => []),
      ctx.jellyfin.getRecentlyAdded(userContext).catch(() => []),
      buildHomeDiscoveryRails(ctx),
    ]);
    const [libraryContinue, iptvContinue] = await Promise.all([
      hydrateContinueWatching(ctx, userContext, continueWatching),
      hydrateContinueWatching(ctx, userContext, iptvProgress.listContinue(session.jellyfinUserId)),
    ]);
    const iptvNextUpRaw = iptvProgress.listNextUp(session.jellyfinUserId);
    const iptvNextUp = await refineIptvNextUp(ctx, userContext, iptvNextUpRaw);

    for (const media of [...continueWatching, ...recentlyAdded]) {
      if (media.identity.jellyfinItemId && media.identity.tmdbId) {
        try {
          ctx.db
            .insert(jellyfinTmdbIndex)
            .values({
              jellyfinItemId: media.identity.jellyfinItemId,
              tmdbId: media.identity.tmdbId,
              mediaType: media.identity.mediaType,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: jellyfinTmdbIndex.jellyfinItemId,
              set: {
                tmdbId: media.identity.tmdbId,
                mediaType: media.identity.mediaType,
                updatedAt: new Date(),
              },
            })
            .run();
        } catch {
          // ignore index failures
        }
      }
    }

    // Prefer Jellyfin CW, then append IPTV resumes for different titles/episodes.
    const continueKey = (m: {
      identity: {
        tmdbId?: number;
        mediaType: string;
        seasonNumber?: number;
        episodeNumber?: number;
      };
    }) => {
      const id = m.identity;
      if (id.mediaType === "episode") {
        return `ep:${id.tmdbId ?? ""}:${id.seasonNumber ?? ""}:${id.episodeNumber ?? ""}`;
      }
      return `${id.mediaType}:${id.tmdbId ?? ""}`;
    };
    /** One card per series on home; multi-episode progress stays on series detail. */
    const dedupeContinueBySeries = (items: Media[]): Media[] => {
      const seen = new Set<string>();
      const out: Media[] = [];
      for (const item of items) {
        const key = continueSeriesKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
      return out;
    };
    const isPlayableContinue = (m: Media) =>
      m.identity.mediaType === "movie" || m.identity.mediaType === "episode";
    const jfContinue = libraryContinue.filter(isPlayableContinue);
    const jfKeys = new Set(jfContinue.map(continueKey));
    // Lists are newest-first — keep the most recently watched episode per series.
    const mergedContinue = dedupeContinueBySeries([
      ...jfContinue,
      ...iptvContinue.filter((m) => isPlayableContinue(m) && !jfKeys.has(continueKey(m))),
    ]);

    const nextKeys = new Set(
      nextUp.map(
        (m) =>
          `${m.identity.tmdbId ?? ""}:${m.identity.seasonNumber ?? ""}:${m.identity.episodeNumber ?? ""}`,
      ),
    );
    const mergedNextUp = [
      ...nextUp,
      ...iptvNextUp.filter((m) => {
        const key = `${m.identity.tmdbId ?? ""}:${m.identity.seasonNumber ?? ""}:${m.identity.episodeNumber ?? ""}`;
        return !nextKeys.has(key);
      }),
    ];

    const personal = [
      { id: "continue", title: "Continue Watching", items: mergedContinue },
      { id: "nextup", title: "Next Up", items: mergedNextUp },
      { id: "recent", title: "Recently Added", items: recentlyAdded },
    ].filter((row) => row.items.length > 0);

    const personalWithArt = await Promise.all(
      personal.map(async (row) => ({
        ...row,
        items: await applyTmdbArtwork(ctx, row.items, userContext),
      })),
    );

    // My List rail (persisted per user).
    const myListKeys = ctx.myList.list(session.jellyfinUserId);
    const myListItems: Media[] = [];
    for (const key of myListKeys.slice(0, 24)) {
      const m = /^(movie|tv):(\d+)$/.exec(key);
      if (!m) continue;
      const resolved = await resolveMediaByTmdb(
        ctx,
        userContext,
        m[1] as "movie" | "tv",
        Number(m[2]),
      ).catch(() => null);
      if (resolved?.media) myListItems.push(resolved.media);
    }
    const myListRail =
      myListItems.length > 0
        ? [{ id: "mylist", title: "My List", items: myListItems }]
        : [];

    // Top 10 from trending (first page, ranked in the UI).
    const trendingRail = discoveryRails.find((r) => r.id === "trending");
    const top10Items = (trendingRail?.items ?? []).slice(0, 10);
    const top10Rail =
      top10Items.length >= 3
        ? [{ id: "top10", title: "Top 10 Today", items: top10Items }]
        : [];

    // Because you watched X — similar to the first Continue Watching title.
    let becauseRail: Array<{ id: string; title: string; items: Media[] }> = [];
    const seed = mergedContinue[0];
    const seedType =
      seed?.identity.mediaType === "episode"
        ? "tv"
        : seed?.identity.mediaType === "movie" || seed?.identity.mediaType === "tv"
          ? seed.identity.mediaType
          : null;
    const seedTmdb = seed?.identity.tmdbId;
    const discovery = ctx.seerr as DiscoveryProvider;
    if (seedType && seedTmdb && discovery.getSimilar) {
      const similar = await discovery.getSimilar(seedType, seedTmdb).catch(() => [] as Media[]);
      const { enrichDiscoveryRow } = await import("../services/media-enrichment.js");
      const enriched = enrichDiscoveryRow(ctx, similar).slice(0, 18);
      if (enriched.length > 0) {
        const label = seed.metadata.title?.replace(/\s*S\d+E\d+\s*$/i, "").trim() || "this title";
        becauseRail = [
          {
            id: `because-${seedType}-${seedTmdb}`,
            title: `Because you watched ${label}`,
            items: enriched,
          },
        ];
      }
    }

    // Keep trending in discovery but prefer Top 10 near the top; drop duplicate trending id if Top 10 present.
    const discoveryRest = top10Rail.length
      ? discoveryRails.filter((r) => r.id !== "trending")
      : discoveryRails;

    return {
      rows: [
        ...personalWithArt.slice(0, 1),
        ...myListRail,
        ...top10Rail,
        ...becauseRail,
        ...personalWithArt.slice(1),
        ...discoveryRest,
      ],
    };
  });
}
