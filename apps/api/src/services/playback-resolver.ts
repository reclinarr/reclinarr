import type {
  AcquisitionSource,
  Media,
  MediaIdentity,
  PlaybackResolveResult,
  PlaybackSource,
  SubtitleTrack,
} from "@reclinarr/shared";
import { normalizeSubtitleLanguage } from "@reclinarr/shared";
import {
  BazarrProvider,
  DispatcharrProvider,
  SeerrProvider,
  type JellyfinProvider,
  type MockDispatcharrProvider,
  type MockJellyfinProvider,
  type MockSeerrProvider,
  type UserContext,
} from "@reclinarr/providers";
import type { AcquisitionManager } from "./acquisition-manager.js";
import type { AppDb } from "../db/client.js";
import { lookupDispatcharrIndex } from "./dispatcharr-index.js";
import type { IptvProgressStore } from "./iptv-progress.js";

/**
 * Server-side only. Frontend must not implement provider priority.
 * Priority: Jellyfin → Cache (auto-started for IPTV Play) → never dual IPTV.
 */
export class PlaybackResolver {
  constructor(
    private readonly jellyfin: JellyfinProvider | MockJellyfinProvider,
    private readonly dispatcharr: DispatcharrProvider | MockDispatcharrProvider,
    private readonly seerr?: SeerrProvider | MockSeerrProvider,
    private readonly acquisitions?: AcquisitionManager,
    private readonly db?: AppDb,
    private readonly bazarr?: BazarrProvider,
    private readonly iptvProgress?: IptvProgressStore,
  ) {}

  async resolve(
    userContext: UserContext,
    identity: MediaIdentity,
    opts?: {
      /** Jellyfin HLS transcode seek/resume — StartTimeTicks. */
      startPositionSeconds?: number;
      audioStreamIndex?: number;
      maxStreamingBitrate?: number;
      deviceProfile?: "web" | "ios" | "android";
    },
  ): Promise<PlaybackResolveResult | null> {
    const target = identity.mediaType === "tv"
      ? await this.seriesPlaybackIdentity(userContext, identity)
      : identity;
    if (!target) return null;
    const result = await this.pickSource(userContext, target, opts);
    if (result?.status === "ready") {
      result.source.resolvedIdentity = target;
    }
    if (!result) return null;
    // Return the stream URL immediately — subtitle enrichment is async via
    // listSubtitles / POST /api/playback/subtitles so Play is not blocked on
    // Bazarr/Seerr/Jellyfin subtitle lookups.
    return result;
  }

  private async seriesPlaybackIdentity(
    userContext: UserContext,
    identity: MediaIdentity,
  ): Promise<MediaIdentity | null> {
    const series = identity.jellyfinItemId
      ? await this.jellyfin.getByJellyfinItemId(userContext, identity.jellyfinItemId)
      : identity.tmdbId
        ? await this.jellyfin.findByTmdb(userContext, identity.tmdbId, "tv")
        : null;
    let episodes: Media[] = [];
    if (series?.identity.jellyfinItemId) {
      episodes = await this.jellyfin.listEpisodesForSeries(userContext, series.identity.jellyfinItemId);
    } else if (identity.tmdbId && this.dispatcharr.listEpisodesForSeries) {
      const vod = await this.dispatcharr.findVodByTmdb(identity.tmdbId, "tv");
      const seriesId = vod?.availability.find((entry) => entry.provider === "dispatcharr")?.seriesId;
      if (seriesId != null) {
        episodes = await this.dispatcharr.listEpisodesForSeries(seriesId, { seriesTmdbId: identity.tmdbId });
      }
    }
    const playable = episodes.filter((episode) => episode.availability.some((entry) =>
      (entry.provider === "jellyfin" || entry.provider === "dispatcharr") && entry.canPlay,
    )).sort((first, second) =>
      Number(first.identity.seasonNumber === 0) - Number(second.identity.seasonNumber === 0) ||
      (first.identity.seasonNumber ?? 0) - (second.identity.seasonNumber ?? 0) ||
      (first.identity.episodeNumber ?? 0) - (second.identity.episodeNumber ?? 0),
    );
    const recent = identity.tmdbId
      ? this.iptvProgress?.listInProgressForSeries(userContext.jellyfinUserId, identity.tmdbId)[0]
      : undefined;
    const resume = recent && playable.find((episode) =>
      episode.identity.seasonNumber === recent.seasonNumber &&
      episode.identity.episodeNumber === recent.episodeNumber,
    );
    const target = resume || playable.find((episode) => episode.availability.some((entry) =>
      "positionSeconds" in entry && typeof entry.positionSeconds === "number" && entry.positionSeconds > 30 &&
      (!("durationSeconds" in entry) || !entry.durationSeconds || entry.positionSeconds < entry.durationSeconds * 0.9),
    )) || playable[0];
    return target ? { ...target.identity, tmdbId: identity.tmdbId ?? target.identity.tmdbId } : null;
  }

  /**
   * Merge Bazarr + Jellyfin text subtitle tracks for a title.
   * Call after playback has started; do not gate resolve on this.
   */
  async listSubtitles(
    userContext: UserContext,
    identity: MediaIdentity,
    opts?: {
      existing?: SubtitleTrack[];
      provider?: PlaybackSource["provider"];
    },
  ): Promise<SubtitleTrack[]> {
    try {
      const stub: PlaybackSource = {
        provider: opts?.provider ?? "cache",
        delivery: { mode: "proxy", url: "" },
        directPlay: true,
        subtitles: opts?.existing,
      };
      const enriched = await this.withSubtitles(userContext, identity, stub);
      return enriched.subtitles ?? [];
    } catch (err) {
      console.error("[subtitles] lookup failed", err);
      return opts?.existing?.filter((t) => Boolean(t.url)) ?? [];
    }
  }

  private async pickSource(
    userContext: UserContext,
    identity: MediaIdentity,
    opts?: {
      startPositionSeconds?: number;
      audioStreamIndex?: number;
      maxStreamingBitrate?: number;
      deviceProfile?: "web" | "ios" | "android";
    },
  ): Promise<PlaybackResolveResult | null> {
    /** Local library hit (movie/series/episode id) — never fall through to IPTV. */
    let skipIptv = Boolean(identity.jellyfinItemId);

    // 1) Jellyfin library
    if (identity.jellyfinItemId || identity.tmdbId) {
      try {
        let resolvedIdentity = identity;
        if (!identity.jellyfinItemId && identity.tmdbId) {
          if (identity.mediaType === "episode") {
            const found = await this.findJellyfinEpisode(userContext, identity);
            if (found.seriesInLibrary) skipIptv = true;
            if (found.episode) resolvedIdentity = found.episode;
          } else {
            const media = await this.jellyfin.findByTmdb(
              userContext,
              identity.tmdbId,
              identity.mediaType,
            );
            if (media?.identity.jellyfinItemId) {
              resolvedIdentity = media.identity;
              skipIptv = true;
            }
          }
        }
        if (resolvedIdentity.jellyfinItemId) {
          skipIptv = true;
          const source = await this.jellyfin.resolvePlayback(userContext, resolvedIdentity, {
            startPositionSeconds: opts?.startPositionSeconds,
            audioStreamIndex: opts?.audioStreamIndex,
            maxStreamingBitrate: opts?.maxStreamingBitrate,
            deviceProfile: opts?.deviceProfile,
          });
          if (source) return { status: "ready", source };
          // Local item failed to resolve — do not open IPTV for it.
          return null;
        }
      } catch {
        if (skipIptv) return null;
        // continue to cache / Dispatcharr
      }
    }

    // 2) Local cache already playable
    const readyCache = this.cachePlaybackSource(userContext, identity);
    if (readyCache) return { status: "ready", source: readyCache };

    // 3) IPTV: only when the title is not in the Jellyfin library
    if (skipIptv) return null;
    if (!this.acquisitions || !this.dispatcharr.resolveVodPlayback) {
      return null;
    }

    const iptv = await this.resolveIptvSource(identity);
    if (!iptv) return null;

    const job = await this.acquisitions.ensureCacheForPlay({
      identity,
      source: iptv.acquisitionSource,
    });

    if (job.playbackAvailable) {
      const source = this.cachePlaybackSource(userContext, identity, iptv.durationSeconds);
      if (source) return { status: "ready", source };
    }

    return { status: "buffering", acquisitionId: job.id };
  }

  private async findJellyfinEpisode(
    userContext: UserContext,
    identity: MediaIdentity,
  ): Promise<{ seriesInLibrary: boolean; episode: MediaIdentity | null }> {
    if (!identity.tmdbId || !this.jellyfin.listEpisodesForSeries) {
      return { seriesInLibrary: false, episode: null };
    }
    const series = await this.jellyfin.findByTmdb(userContext, identity.tmdbId, "tv");
    const seriesId = series?.identity.jellyfinItemId;
    if (!seriesId) return { seriesInLibrary: false, episode: null };
    const episodes = await this.jellyfin.listEpisodesForSeries(userContext, seriesId);
    const hit = episodes.find(
      (e) =>
        e.identity.seasonNumber === identity.seasonNumber &&
        e.identity.episodeNumber === identity.episodeNumber,
    );
    return {
      seriesInLibrary: true,
      episode: hit?.identity.jellyfinItemId ? hit.identity : null,
    };
  }

  private cachePlaybackSource(
    userContext: UserContext,
    identity: MediaIdentity,
    durationSeconds?: number,
  ): PlaybackSource | null {
    const cache = this.acquisitions?.cacheAvailabilityFor(identity);
    if (!cache?.playbackAvailable || !cache.acquisitionId) return null;
    const job = this.acquisitions?.get(cache.acquisitionId);
    const progress = this.iptvProgress?.get(userContext.jellyfinUserId, identity);
    const startPositionSeconds =
      progress && !progress.completed && progress.positionSeconds > 30
        ? progress.positionSeconds
        : undefined;
    const progressDuration = progress?.durationSeconds;
    return {
      provider: "cache",
      delivery: {
        mode: "proxy",
        url: `/api/playback/cache/${cache.acquisitionId}/hls/index.m3u8`,
      },
      directPlay: true,
      hls: true,
      mimeType: "application/vnd.apple.mpegurl",
      acquisitionId: cache.acquisitionId,
      bytesDownloaded: cache.bytesDownloaded,
      totalBytes: cache.totalBytes,
      downloadComplete: cache.complete,
      cacheExpiresAt: job?.cacheExpiresAt,
      ...(startPositionSeconds != null ? { startPositionSeconds } : {}),
      ...(durationSeconds != null && durationSeconds > 0
        ? { durationSeconds }
        : progressDuration != null && progressDuration > 0
          ? { durationSeconds: progressDuration }
          : {}),
    };
  }

  /**
   * Resolve Dispatcharr uuid/stream for acquisition + optional catalogue duration.
   * Does not return a live IPTV remux PlaybackSource (connection budget).
   */
  private async resolveIptvSource(identity: MediaIdentity): Promise<{
    acquisitionSource: AcquisitionSource;
    durationSeconds?: number;
  } | null> {
    if (
      identity.tmdbId &&
      identity.mediaType === "episode" &&
      this.dispatcharr.listEpisodesForSeries
    ) {
      const preferredLanguages =
        this.dispatcharr instanceof DispatcharrProvider
          ? this.dispatcharr.getPreferredLanguages()
          : undefined;
      let seriesId =
        this.db != null
          ? lookupDispatcharrIndex(this.db, identity.tmdbId, "tv", preferredLanguages)
              ?.dispatcharrId
          : undefined;
      if (seriesId === undefined && "findEpisodeBySeriesTmdb" in this.dispatcharr) {
        let titleHint: string | undefined;
        if (this.seerr?.getDetails) {
          const details = await this.seerr.getDetails("tv", identity.tmdbId).catch(() => null);
          titleHint = details?.metadata.title;
        }
        const episode = await (this.dispatcharr as DispatcharrProvider)
          .findEpisodeBySeriesTmdb(
            identity.tmdbId,
            identity.seasonNumber ?? 0,
            identity.episodeNumber ?? 0,
            { titleHint },
          )
          .catch(() => null);
        return acquisitionFromMedia(episode, "episode");
      }
      if (seriesId !== undefined) {
        const episodes = await this.dispatcharr
          .listEpisodesForSeries(seriesId, { seriesTmdbId: identity.tmdbId })
          .catch(() => []);
        const hit = episodes.find(
          (e) =>
            e.identity.seasonNumber === identity.seasonNumber &&
            e.identity.episodeNumber === identity.episodeNumber,
        );
        return acquisitionFromMedia(hit ?? null, "episode");
      }
      return null;
    }

    if (identity.tmdbId && (identity.mediaType === "movie" || identity.mediaType === "tv")) {
      let titleHint: string | undefined;
      let yearHint: number | undefined;
      let seerrDuration: number | undefined;
      if (this.seerr?.getDetails) {
        const details = await this.seerr
          .getDetails(identity.mediaType, identity.tmdbId)
          .catch(() => null);
        titleHint = details?.metadata.title;
        yearHint = details?.metadata.year;
        seerrDuration = metadataDurationSeconds(details);
      }
      const preferredLanguages =
        this.dispatcharr instanceof DispatcharrProvider
          ? this.dispatcharr.getPreferredLanguages()
          : undefined;
      const indexed =
        this.db != null
          ? lookupDispatcharrIndex(
              this.db,
              identity.tmdbId,
              identity.mediaType,
              preferredLanguages,
            )
          : null;
      const media = await this.dispatcharr
        .findVodByTmdb(identity.tmdbId, identity.mediaType, {
          titleHint,
          yearHint,
          ...(indexed?.dispatcharrId != null ? { dispatcharrId: indexed.dispatcharrId } : {}),
        })
        .catch(() => null);
      const fromMedia = acquisitionFromMedia(media, identity.mediaType === "tv" ? "series" : "movie");
      if (!fromMedia) return null;
      return {
        ...fromMedia,
        durationSeconds: fromMedia.durationSeconds ?? seerrDuration,
      };
    }

    return null;
  }

  private async withSubtitles(
    userContext: UserContext,
    identity: MediaIdentity,
    source: PlaybackSource,
  ): Promise<PlaybackSource> {
    const existing = source.subtitles ?? [];
    const fromBazarr = await this.bazarrSubtitles(identity);
    const fromJellyfin =
      source.provider === "jellyfin" || existing.some((track) => track.url)
        ? existing
        : await this.jellyfinTextSubtitles(userContext, identity);
    const subtitles = dedupeSubtitles([...fromBazarr, ...fromJellyfin]);
    return { ...source, subtitles };
  }

  private async bazarrSubtitles(identity: MediaIdentity): Promise<SubtitleTrack[]> {
    if (!this.bazarr?.isConfigured()) return [];
    if (identity.mediaType !== "movie" && identity.mediaType !== "episode") return [];
    const hint = await this.subtitleHint(identity);
    return this.bazarr.listSubtitles({
      mediaType: identity.mediaType,
      imdbId: hint.imdbId,
      tvdbId: hint.tvdbId,
      title: hint.title,
      year: hint.year,
      seasonNumber: identity.seasonNumber,
      episodeNumber: identity.episodeNumber,
    });
  }

  private async subtitleHint(identity: MediaIdentity): Promise<{
    imdbId?: string;
    tvdbId?: number;
    title?: string;
    year?: number;
  }> {
    const hint: {
      imdbId?: string;
      tvdbId?: number;
      title?: string;
      year?: number;
    } = { tvdbId: identity.tvdbId };
    if (!identity.tmdbId || !(this.seerr instanceof SeerrProvider)) return hint;
    const type = identity.mediaType === "movie" ? "movie" : "tv";
    const ids = await this.seerr.getCatalogIds(type, identity.tmdbId).catch(() => null);
    if (!ids) return hint;
    return {
      imdbId: ids.imdbId,
      tvdbId: hint.tvdbId ?? ids.tvdbId,
      title: ids.title,
      year: ids.year,
    };
  }

  private async jellyfinTextSubtitles(
    userContext: UserContext,
    identity: MediaIdentity,
  ): Promise<SubtitleTrack[]> {
    let itemId = identity.jellyfinItemId;
    if (!itemId && identity.tmdbId && identity.mediaType === "movie") {
      const media = await this.jellyfin
        .findByTmdb(userContext, identity.tmdbId, "movie")
        .catch(() => null);
      itemId = media?.identity.jellyfinItemId;
    }
    if (!itemId) return [];
    const playback = await this.jellyfin.resolvePlayback(userContext, {
      ...identity,
      jellyfinItemId: itemId,
    });
    return (playback?.subtitles ?? []).filter((track) => Boolean(track.url));
  }
}

function acquisitionFromMedia(
  media: Media | null | undefined,
  kind: "movie" | "episode" | "series",
): { acquisitionSource: AcquisitionSource; durationSeconds?: number } | null {
  if (!media || kind === "series") return null;
  const avail = media.availability.find((a) => a.provider === "dispatcharr");
  if (!avail?.uuid || !avail.canPlay) return null;
  return {
    acquisitionSource: {
      provider: "dispatcharr",
      uuid: avail.uuid,
      streamId: avail.candidates[0]?.streamId,
      m3uAccountId: avail.candidates[0]?.m3uAccountId,
      movieId: avail.movieId,
      episodeId: avail.episodeId,
    },
    durationSeconds: metadataDurationSeconds(media),
  };
}

function metadataDurationSeconds(
  media: { metadata: { durationSeconds?: number; runtimeMinutes?: number } } | null | undefined,
): number | undefined {
  if (!media) return undefined;
  if (media.metadata.durationSeconds != null && media.metadata.durationSeconds > 0) {
    return media.metadata.durationSeconds;
  }
  if (media.metadata.runtimeMinutes != null && media.metadata.runtimeMinutes > 0) {
    return media.metadata.runtimeMinutes * 60;
  }
  return undefined;
}

function dedupeSubtitles(tracks: SubtitleTrack[]): SubtitleTrack[] {
  const seen = new Set<string>();
  const out: SubtitleTrack[] = [];
  for (const track of tracks) {
    if (!track.url) continue;
    const key = [
      normalizeSubtitleLanguage(track.language),
      track.forced ? "1" : "0",
      track.hearingImpaired ? "1" : "0",
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
  }
  return out;
}
