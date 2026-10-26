import type {
  DispatcharrStreamCandidate,
  EpgProgramme,
  LiveChannel,
  LiveChannelGroup,
  LiveNowNext,
  Media,
  MediaIdentity,
  PlaybackSource,
  ProviderHealth,
  CatalogueLanguageScored,
  PlayableLanguageConfidence,
  TmdbLanguageReference,
} from "@reclinarr/shared";
import {
  isPlayableLanguageConfidence,
  parseCatalogueLanguageHints,
  parsePreferredLanguages,
  parseQualityHints,
  pickPreferredByCatalogueLanguage,
  ProviderError,
  rankDispatcharrStreamCandidates,
} from "@reclinarr/shared";
import { HttpClient } from "../http.js";
import type {
  AcquisitionSourceProvider,
  LiveTvProvider,
  VodLookupOptions,
  VodProvider,
} from "../types.js";
import { DISPATCHARR_CAPABILITIES } from "../types.js";
import {
  authHeaders,
  cloudflareAccessHeaders,
  type CloudflareAccessServiceToken,
  type DispatcharrAuth,
} from "./auth.js";
import {
  mapEpisodeToMedia,
  mapMovieToMedia,
  mapSeriesToMedia,
  parseTmdbId,
  tmdbMatches,
} from "./map.js";
import {
  DispatcharrChannelGroupSchema,
  DispatcharrChannelSchema,
  DispatcharrEpisodeSchema,
  DispatcharrMovieProviderInfoSchema,
  DispatcharrMovieProviderSchema,
  DispatcharrMovieSchema,
  DispatcharrPageSchema,
  DispatcharrProgramSchema,
  DispatcharrSeriesProviderInfoSchema,
  DispatcharrSeriesSchema,
  type DispatcharrChannel,
  type DispatcharrMovie,
  type DispatcharrSeries,
} from "./schemas.js";
import { z } from "zod";

export interface DispatcharrProviderOptions {
  baseUrl: string;
  auth?: DispatcharrAuth;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Public Reclinarr base used for browser-facing proxy URLs */
  reclinarrPublicUrl?: string;
  /** Bypass Cloudflare Access in front of Dispatcharr */
  cloudflareAccess?: CloudflareAccessServiceToken;
  /**
   * Preferred IPTV catalogue languages (strongest first).
   * Used to rank EN-/IT- prefixed VOD rows that share a TMDb id.
   */
  preferredLanguages?: string[];
}

function referenceCacheKey(reference?: TmdbLanguageReference): string {
  if (!reference) return "noref";
  return [reference.originalLanguage, reference.title, reference.originalTitle]
    .map((v) => v ?? "")
    .join("|");
}

const TokenSchema = z.object({
  access: z.string(),
  refresh: z.string().optional(),
});

const MoviesPageSchema = DispatcharrPageSchema(DispatcharrMovieSchema);
const SeriesPageSchema = DispatcharrPageSchema(DispatcharrSeriesSchema);
const EpisodesPageSchema = DispatcharrPageSchema(DispatcharrEpisodeSchema);
const ChannelsPageSchema = DispatcharrPageSchema(DispatcharrChannelSchema);
const ProvidersSchema = z.array(DispatcharrMovieProviderSchema);
const GroupsSchema = z.union([
  z.array(DispatcharrChannelGroupSchema),
  DispatcharrPageSchema(DispatcharrChannelGroupSchema),
]);
const ProgramsListSchema = z.array(DispatcharrProgramSchema);
const GridSchema = z
  .object({
    data: z.array(DispatcharrProgramSchema).optional(),
  })
  .passthrough();

export class DispatcharrProvider implements VodProvider, LiveTvProvider, AcquisitionSourceProvider {
  readonly id = "dispatcharr";
  private readonly baseUrl: string;
  private readonly auth?: DispatcharrAuth;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly reclinarrPublicUrl?: string;
  private readonly cloudflareAccess?: CloudflareAccessServiceToken;
  private readonly preferredLanguages: string[];
  private accessToken?: string;
  private refreshToken?: string;
  /** Positive hits and confirmed misses only — never transient errors. */
  private readonly tmdbCache = new Map<string, { at: number; media: Media | null }>();
  private static readonly TMDB_CACHE_TTL_MS = 10 * 60_000;
  private static readonly TMDB_CACHE_MAX_ENTRIES = 2000;
  private groupsCache?: { at: number; items: LiveChannelGroup[] };
  private channelsCache?: { at: number; items: LiveChannel[] };

  constructor(opts: DispatcharrProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.auth = opts.auth;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl;
    this.reclinarrPublicUrl = opts.reclinarrPublicUrl?.replace(/\/+$/, "");
    this.cloudflareAccess = opts.cloudflareAccess;
    this.preferredLanguages = parsePreferredLanguages(
      (opts.preferredLanguages ?? ["en"]).join(","),
    );
  }

  /** Preferred catalogue languages used for VOD variant ranking. */
  getPreferredLanguages(): string[] {
    return this.preferredLanguages;
  }

  private gateHeaders(): Record<string, string> {
    return cloudflareAccessHeaders(this.cloudflareAccess);
  }

  capabilities() {
    return DISPATCHARR_CAPABILITIES;
  }

  private async ensureJwt(force = false): Promise<void> {
    if (!this.auth || this.auth.type !== "credentials") return;
    if (this.accessToken && !force) return;

    const http = new HttpClient({
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      serviceName: "dispatcharr",
      fetchImpl: this.fetchImpl,
      defaultHeaders: this.gateHeaders(),
    });

    if (this.refreshToken && force) {
      try {
        const { data } = await http.request("POST", "/api/accounts/token/refresh/", {
          body: { refresh: this.refreshToken },
          schema: z.object({ access: z.string() }),
        });
        this.accessToken = data.access;
        return;
      } catch {
        this.refreshToken = undefined;
      }
    }

    try {
      const { data } = await http.request("POST", "/api/accounts/token/", {
        body: { username: this.auth.username, password: this.auth.password },
        schema: TokenSchema,
      });
      this.accessToken = data.access;
      this.refreshToken = data.refresh;
    } catch (err) {
      throw this.rewriteAccessError(err);
    }
  }

  private async http(forceRefresh = false): Promise<HttpClient> {
    if (!this.baseUrl) {
      throw new ProviderError("DISPATCHARR_URL not set", {
        code: "unavailable",
        provider: this.id,
      });
    }
    if (!this.auth) {
      throw new ProviderError("Dispatcharr auth not configured", {
        code: "unauthorized",
        provider: this.id,
        statusCode: 401,
      });
    }
    await this.ensureJwt(forceRefresh);
    return new HttpClient({
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      serviceName: "dispatcharr",
      fetchImpl: this.fetchImpl,
      defaultHeaders: {
        ...this.gateHeaders(),
        ...authHeaders(this.auth, this.accessToken),
      },
    });
  }

  /** Run an authenticated request; refresh JWT once on 401 when using credentials. */
  private async withAuthRetry<T>(fn: (http: HttpClient) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.http());
    } catch (err) {
      if (
        err instanceof ProviderError &&
        err.code === "unauthorized" &&
        this.auth?.type === "credentials"
      ) {
        return await fn(await this.http(true));
      }
      throw err;
    }
  }

  private rewriteAccessError(err: unknown): Error {
    if (!(err instanceof ProviderError)) return err as Error;
    const details = JSON.stringify(err.details ?? "");
    const msg = err.message ?? "";
    const looksLikeCfAccess =
      details.includes("cloudflareaccess.com") ||
      details.includes("Cloudflare-Access") ||
      details.includes("cdn-cgi/access") ||
      details.includes("<html") ||
      msg.includes("schema mismatch") ||
      msg.includes("HTTP 302");
    if (!looksLikeCfAccess) return err;
    return new ProviderError(
      "Dispatcharr is behind Cloudflare Access — set DISPATCHARR_CF_ACCESS_CLIENT_ID/SECRET (service token) or use an internal URL",
      {
        code: "unauthorized",
        provider: this.id,
        statusCode: 401,
        details: err.details,
        cause: err,
      },
    );
  }

  async health(): Promise<ProviderHealth> {
    if (!this.baseUrl) {
      return {
        id: this.id,
        status: "unconfigured",
        message: "DISPATCHARR_URL not set",
        capabilities: this.capabilities(),
      };
    }
    if (!this.auth) {
      return {
        id: this.id,
        status: "unconfigured",
        message: "Dispatcharr auth not configured (set DISPATCHARR_API_KEY or username/password)",
        capabilities: this.capabilities(),
      };
    }
    const started = Date.now();
    try {
      const http = await this.http();
      await http.request("GET", "/api/vod/movies/", {
        query: { page: 1, page_size: 1 },
        schema: MoviesPageSchema,
      });
      return {
        id: this.id,
        status: "ok",
        latencyMs: Date.now() - started,
        capabilities: this.capabilities(),
      };
    } catch (err) {
      const rewritten = this.rewriteAccessError(err);
      return {
        id: this.id,
        status: "down",
        latencyMs: Date.now() - started,
        message: rewritten instanceof Error ? rewritten.message : String(rewritten),
        capabilities: this.capabilities(),
      };
    }
  }

  /**
   * Find the on-demand copy of a TMDb title in a preferred language.
   * Untagged copies only count when `reference` (TMDb title + original language)
   * vouches for them; without a reference they are never offered.
   */
  async findVodByTmdb(
    tmdbId: number,
    mediaType: "movie" | "tv",
    opts?: VodLookupOptions,
  ): Promise<Media | null> {
    const languages = opts?.preferredLanguages?.length
      ? opts.preferredLanguages
      : this.preferredLanguages;
    const reference = opts?.reference;
    const cacheKey = `${mediaType}:${tmdbId}:${languages.join(",")}:${referenceCacheKey(reference)}`;
    const cached = this.tmdbCache.get(cacheKey);
    if (cached && Date.now() - cached.at < DispatcharrProvider.TMDB_CACHE_TTL_MS) {
      return cached.media;
    }

    try {
      const media = await this.withAuthRetry(async () => {
        // Fast path: known Dispatcharr row id (SQLite index) — skip catalogue search,
        // but only when the row still passes the language check.
        if (opts?.dispatcharrId != null) {
          const hit =
            mediaType === "movie"
              ? await this.movieFromKnownId(opts.dispatcharrId, tmdbId, languages, reference)
              : await this.seriesFromKnownId(opts.dispatcharrId, tmdbId, languages, reference);
          if (hit) return hit;
        }
        return mediaType === "movie"
          ? await this.findMovieByTmdb(tmdbId, opts?.titleHint, opts?.yearHint, languages, reference)
          : await this.findSeriesByTmdb(tmdbId, opts?.titleHint, opts?.yearHint, languages, reference);
      });
      this.tmdbCache.delete(cacheKey);
      this.tmdbCache.set(cacheKey, { at: Date.now(), media });
      if (this.tmdbCache.size > DispatcharrProvider.TMDB_CACHE_MAX_ENTRIES) {
        const oldest = this.tmdbCache.keys().next().value;
        if (oldest !== undefined) this.tmdbCache.delete(oldest);
      }
      return media;
    } catch (err) {
      if (err instanceof ProviderError && err.code === "unauthorized") throw err;
      // Transient errors must not poison the cache for the process lifetime.
      return null;
    }
  }

  /** Direct movie fetch by Dispatcharr id (avoids 70k catalogue search). */
  private async fetchMovieRow(id: number): Promise<DispatcharrMovie | null> {
    const http = await this.http();
    try {
      const { status, data } = await http.request<unknown>("GET", `/api/vod/movies/${id}/`, {
        allowStatuses: [200, 404],
      });
      if (status === 404) return null;
      const parsed = DispatcharrMovieSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async fetchSeriesRow(id: number): Promise<DispatcharrSeries | null> {
    const http = await this.http();
    try {
      const { status, data } = await http.request<unknown>("GET", `/api/vod/series/${id}/`, {
        allowStatuses: [200, 404],
      });
      if (status === 404) return null;
      const parsed = DispatcharrSeriesSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Known-id fast path; null when stale (other TMDb id) or not trustworthy in language. */
  private async movieFromKnownId(
    id: number,
    tmdbId: number,
    languages: string[],
    reference?: TmdbLanguageReference,
  ): Promise<Media | null> {
    const row = await this.fetchMovieRow(id);
    if (!row || !tmdbMatches(row.tmdb_id, tmdbId)) return null;
    const best = pickPreferredByCatalogueLanguage([row], languages, {
      nameOf: (m) => m.name,
      idOf: (m) => m.id,
      reference,
    });
    if (!best) return null;
    return this.enrichMovie(best.item, best.catalogueLanguage, best.confidence, languages);
  }

  private async seriesFromKnownId(
    id: number,
    tmdbId: number,
    languages: string[],
    reference?: TmdbLanguageReference,
  ): Promise<Media | null> {
    const row = await this.fetchSeriesRow(id);
    if (!row || !tmdbMatches(row.tmdb_id, tmdbId)) return null;
    const best = pickPreferredByCatalogueLanguage([row], languages, {
      nameOf: (s) => s.name,
      idOf: (s) => s.id,
      reference,
    });
    if (!best) return null;
    return mapSeriesToMedia(best.item, {
      catalogueLanguage: best.catalogueLanguage,
      languageConfidence: best.confidence,
    });
  }

  async resolveVodPlayback(identity: MediaIdentity): Promise<PlaybackSource | null> {
    // Episode: resolve specific SxxExx from series catalogue.
    if (
      identity.mediaType === "episode" &&
      identity.tmdbId &&
      identity.seasonNumber != null &&
      identity.episodeNumber != null
    ) {
      const episode = await this.findEpisodeBySeriesTmdb(
        identity.tmdbId,
        identity.seasonNumber,
        identity.episodeNumber,
      );
      const avail = episode?.availability.find((a) => a.provider === "dispatcharr");
      if (!avail?.uuid || !avail.canPlay) return null;
      return this.resolvePlaybackFromUuid(
        avail.uuid,
        "episode",
        avail.candidates[0]?.streamId,
        { durationSeconds: mediaDurationSeconds(episode) },
      );
    }

    const media =
      identity.tmdbId && (identity.mediaType === "movie" || identity.mediaType === "tv")
        ? await this.findVodByTmdb(identity.tmdbId, identity.mediaType).catch(() => null)
        : null;
    const dispatcharr =
      media?.availability.find((a) => a.provider === "dispatcharr") ??
      (await this.findAvailability(identity));
    if (!dispatcharr?.uuid || !dispatcharr.canPlay) return null;

    const kind =
      identity.mediaType === "episode" || dispatcharr.episodeId
        ? "episode"
        : identity.mediaType === "tv" || dispatcharr.seriesId
          ? "series"
          : "movie";

    // Prefer movie/episode proxy paths; series uuid is not a stream endpoint.
    if (kind === "series") {
      return null;
    }

    const streamId = dispatcharr.candidates[0]?.streamId;
    return this.resolvePlaybackFromUuid(dispatcharr.uuid, kind, streamId, {
      durationSeconds: mediaDurationSeconds(media),
    });
  }

  async listEpisodesForSeries(
    seriesId: number,
    opts?: { seriesTmdbId?: number },
  ): Promise<Media[]> {
    const http = await this.http();
    const items: Media[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= 50) {
      const { data } = await http.request("GET", "/api/vod/episodes/", {
        query: { series: seriesId, page, page_size: 100 },
        schema: EpisodesPageSchema,
      });
      const results = data.results ?? [];
      for (const ep of results) {
        items.push(mapEpisodeToMedia(ep, opts?.seriesTmdbId));
      }
      const count = data.count ?? items.length;
      totalPages = Math.max(1, Math.ceil(count / 100));
      if (results.length === 0) break;
      page += 1;
    }
    items.sort((a, b) => {
      const sa = a.identity.seasonNumber ?? 0;
      const sb = b.identity.seasonNumber ?? 0;
      if (sa !== sb) return sa - sb;
      return (a.identity.episodeNumber ?? 0) - (b.identity.episodeNumber ?? 0);
    });
    if (items.length > 0) return items;
    return this.episodesFromProviderInfo(seriesId, opts?.seriesTmdbId);
  }

  /**
   * XC catalogues sometimes keep the episode tree on series provider-info
   * before (or instead of) the /episodes/ table.
   */
  private async episodesFromProviderInfo(
    seriesId: number,
    seriesTmdbId?: number,
  ): Promise<Media[]> {
    const http = await this.http();
    try {
      const { status, data } = await http.request<unknown>(
        "GET",
        `/api/vod/series/${seriesId}/provider-info/`,
        // Cold calls make Dispatcharr fetch the whole episode tree upstream first.
        { allowStatuses: [200, 404], timeoutMs: Math.max(this.timeoutMs, 60_000) },
      );
      if (status === 404) return [];
      const parsed = z
        .union([
          DispatcharrSeriesProviderInfoSchema,
          z.array(DispatcharrSeriesProviderInfoSchema),
        ])
        .safeParse(data);
      if (!parsed.success) return [];
      const payloads = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
      const items: Media[] = [];
      for (const payload of payloads) {
        for (const episodes of Object.values(payload.episodes ?? {})) {
          for (const raw of episodes) {
            const episode = DispatcharrEpisodeSchema.safeParse(raw);
            if (!episode.success || !episode.data.uuid) continue;
            items.push(mapEpisodeToMedia(episode.data, seriesTmdbId));
          }
        }
      }
      items.sort((a, b) => {
        const sa = a.identity.seasonNumber ?? 0;
        const sb = b.identity.seasonNumber ?? 0;
        if (sa !== sb) return sa - sb;
        return (a.identity.episodeNumber ?? 0) - (b.identity.episodeNumber ?? 0);
      });
      return items;
    } catch {
      return [];
    }
  }

  async findEpisodeBySeriesTmdb(
    seriesTmdbId: number,
    seasonNumber: number,
    episodeNumber: number,
    opts?: {
      titleHint?: string;
      preferredLanguages?: string[];
      reference?: TmdbLanguageReference;
    },
  ): Promise<Media | null> {
    const series = await this.findVodByTmdb(seriesTmdbId, "tv", {
      titleHint: opts?.titleHint,
      ...(opts?.preferredLanguages?.length
        ? { preferredLanguages: opts.preferredLanguages }
        : {}),
      ...(opts?.reference ? { reference: opts.reference } : {}),
    });
    const seriesId = series?.availability.find((a) => a.provider === "dispatcharr")?.seriesId;
    if (!seriesId) return null;
    const episodes = await this.listEpisodesForSeries(seriesId, {
      seriesTmdbId,
    });
    return (
      episodes.find(
        (e) =>
          e.identity.seasonNumber === seasonNumber &&
          e.identity.episodeNumber === episodeNumber,
      ) ?? null
    );
  }

  /**
   * Authenticated upstream URL + headers for ffmpeg (supports `-ss` before `-i`).
   * Prefer this for VOD scrub seeks so ffmpeg can input-seek instead of
   * discarding a pipe from t=0.
   */
  async resolveVodStreamTarget(input: {
    uuid: string;
    kind: "movie" | "episode";
    streamId?: string;
  }): Promise<{ url: string; headers: Record<string, string> }> {
    await this.ensureJwt();
    if (!this.auth) {
      throw new ProviderError("Dispatcharr auth not configured", {
        code: "unauthorized",
        provider: this.id,
      });
    }

    const path = `/proxy/vod/${input.kind}/${encodeURIComponent(input.uuid)}`;
    const url = new URL(this.baseUrl + path);
    if (input.streamId) url.searchParams.set("stream_id", input.streamId);
    if (this.accessToken) url.searchParams.set("token", this.accessToken);

    return {
      url: url.toString(),
      headers: {
        ...this.gateHeaders(),
        ...authHeaders(this.auth, this.accessToken),
      },
    };
  }

  /** Open upstream Dispatcharr VOD proxy with Reclinarr-held auth. */
  async openVodStream(input: {
    uuid: string;
    kind: "movie" | "episode";
    streamId?: string;
    /** e.g. `bytes=123-` for resume */
    range?: string;
    signal?: AbortSignal;
  }): Promise<Response> {
    const target = await this.resolveVodStreamTarget(input);
    const headers: Record<string, string> = { ...target.headers };
    if (input.range) headers.Range = input.range;

    const res = await (this.fetchImpl ?? fetch)(target.url, {
      headers,
      signal: input.signal,
      redirect: "follow",
    });

    if ((res.status === 401 || res.status === 302) && this.auth?.type === "credentials") {
      await this.ensureJwt(true);
      const retried = await this.resolveVodStreamTarget(input);
      return (this.fetchImpl ?? fetch)(retried.url, {
        headers: {
          ...retried.headers,
          ...(input.range ? { Range: input.range } : {}),
        },
        signal: input.signal,
        redirect: "follow",
      });
    }
    return res;
  }

  private async findAvailability(identity: MediaIdentity) {
    if (!identity.tmdbId || (identity.mediaType !== "movie" && identity.mediaType !== "tv")) {
      // Direct uuid play path from prior availability
      return null;
    }
    const media = await this.findVodByTmdb(
      identity.tmdbId,
      identity.mediaType === "tv" ? "tv" : "movie",
    );
    return media?.availability.find((a) => a.provider === "dispatcharr") ?? null;
  }

  /**
   * Lightweight catalogue match for background index warm — search + language pick only.
   * Skips providers/provider-info fan-out from enrichMovie.
   */
  async findVodCatalogueMatch(
    tmdbId: number,
    mediaType: "movie" | "tv",
    opts?: { titleHint?: string; yearHint?: number; reference?: TmdbLanguageReference },
  ): Promise<{
    id: number;
    uuid: string;
    name: string;
    catalogueLanguage?: string;
    languageConfidence: PlayableLanguageConfidence;
  } | null> {
    try {
      return await this.withAuthRetry(async () => {
        const best =
          mediaType === "movie"
            ? await this.matchMovieByTmdb(
                tmdbId,
                opts?.titleHint,
                opts?.yearHint,
                this.preferredLanguages,
                opts?.reference,
              )
            : await this.matchSeriesByTmdb(
                tmdbId,
                opts?.titleHint,
                opts?.yearHint,
                this.preferredLanguages,
                opts?.reference,
              );
        if (!best) return null;
        return {
          id: best.item.id,
          uuid: best.item.uuid,
          name: best.item.name,
          catalogueLanguage: best.catalogueLanguage,
          languageConfidence: best.confidence,
        };
      });
    } catch (err) {
      if (err instanceof ProviderError && err.code === "unauthorized") throw err;
      return null;
    }
  }

  private async findMovieByTmdb(
    tmdbId: number,
    titleHint?: string,
    yearHint?: number,
    languages: string[] = this.preferredLanguages,
    reference?: TmdbLanguageReference,
  ): Promise<Media | null> {
    const best = await this.matchMovieByTmdb(tmdbId, titleHint, yearHint, languages, reference);
    if (!best) return null;
    return this.enrichMovie(best.item, best.catalogueLanguage, best.confidence, languages);
  }

  private async matchMovieByTmdb(
    tmdbId: number,
    titleHint?: string,
    yearHint?: number,
    languages: string[] = this.preferredLanguages,
    reference?: TmdbLanguageReference,
  ): Promise<CatalogueLanguageScored<DispatcharrMovie> | null> {
    const http = await this.http();
    // Upstream has no tmdb_id filter — search (+ year when known) then match.
    const queries = this.searchQueries(titleHint, tmdbId);
    const seen = new Map<number, DispatcharrMovie>();
    for (const search of queries) {
      const hit = await this.searchMoviesMatchingTmdb(http, search, tmdbId, yearHint);
      for (const m of hit) seen.set(m.id, m);
      if (seen.size > 0) break; // stop once year-scoped search finds the title
    }
    // Year filter can be too strict (wrong metadata year) — retry without year.
    if (seen.size === 0 && yearHint != null) {
      for (const search of queries) {
        const hit = await this.searchMoviesMatchingTmdb(http, search, tmdbId, undefined);
        for (const m of hit) seen.set(m.id, m);
        if (seen.size > 0) break;
      }
    }
    return pickPreferredByCatalogueLanguage([...seen.values()], languages, {
      nameOf: (m) => m.name,
      idOf: (m) => m.id,
      reference,
    });
  }

  private async searchMoviesMatchingTmdb(
    http: HttpClient,
    search: string,
    tmdbId: number,
    yearHint?: number,
  ): Promise<DispatcharrMovie[]> {
    const query: Record<string, string | number> = {
      search,
      page: 1,
      page_size: 100,
    };
    if (yearHint != null && yearHint > 0) query.year = yearHint;
    const { data } = await http.request("GET", "/api/vod/movies/", {
      query,
      schema: MoviesPageSchema,
    });
    return (data.results ?? []).filter((m) => tmdbMatches(m.tmdb_id, tmdbId));
  }

  private async findSeriesByTmdb(
    tmdbId: number,
    titleHint?: string,
    yearHint?: number,
    languages: string[] = this.preferredLanguages,
    reference?: TmdbLanguageReference,
  ): Promise<Media | null> {
    const best = await this.matchSeriesByTmdb(tmdbId, titleHint, yearHint, languages, reference);
    if (!best) return null;
    return mapSeriesToMedia(best.item, {
      catalogueLanguage: best.catalogueLanguage,
      languageConfidence: best.confidence,
    });
  }

  private async matchSeriesByTmdb(
    tmdbId: number,
    titleHint?: string,
    yearHint?: number,
    languages: string[] = this.preferredLanguages,
    reference?: TmdbLanguageReference,
  ): Promise<CatalogueLanguageScored<DispatcharrSeries> | null> {
    const http = await this.http();
    const queries = this.searchQueries(titleHint, tmdbId);
    const seen = new Map<number, DispatcharrSeries>();
    for (const search of queries) {
      const hit = await this.searchSeriesMatchingTmdb(http, search, tmdbId, yearHint);
      for (const s of hit) seen.set(s.id, s);
      if (seen.size > 0) break;
    }
    if (seen.size === 0 && yearHint != null) {
      for (const search of queries) {
        const hit = await this.searchSeriesMatchingTmdb(http, search, tmdbId, undefined);
        for (const s of hit) seen.set(s.id, s);
        if (seen.size > 0) break;
      }
    }
    return pickPreferredByCatalogueLanguage([...seen.values()], languages, {
      nameOf: (s) => s.name,
      idOf: (s) => s.id,
      reference,
    });
  }

  private async searchSeriesMatchingTmdb(
    http: HttpClient,
    search: string,
    tmdbId: number,
    yearHint?: number,
  ): Promise<DispatcharrSeries[]> {
    const query: Record<string, string | number> = {
      search,
      page: 1,
      page_size: 100,
    };
    if (yearHint != null && yearHint > 0) query.year = yearHint;
    const { data } = await http.request("GET", "/api/vod/series/", {
      query,
      schema: SeriesPageSchema,
    });
    return (data.results ?? []).filter((s) => tmdbMatches(s.tmdb_id, tmdbId));
  }

  /** Build search strings that work against prefixed IPTV titles (e.g. "NF - Fight Club"). */
  private searchQueries(titleHint?: string, tmdbId?: number): string[] {
    const raw = titleHint?.trim();
    const out = new Set<string>();
    if (raw) {
      out.add(raw);
      // Strip common leading catalogue prefixes: "NF - ", "EN - ", "AR-DOC-S - "
      const stripped = raw.replace(/^[A-Z0-9][A-Z0-9_-]{0,12}\s*-\s*/i, "").trim();
      if (stripped && stripped !== raw) out.add(stripped);
      // First significant words help when titles are noisy
      const words = stripped || raw;
      const short = words.split(/\s+/).slice(0, 3).join(" ");
      if (short.length >= 3) out.add(short);
    }
    // Fallback when Seerr title hint is missing — some catalogues index the TMDb id.
    if (tmdbId != null && tmdbId > 0) out.add(String(tmdbId));
    return [...out];
  }

  /**
   * Attach ranked stream candidates. Null when the movie has streams but none
   * survive the language filter (e.g. only wrong-language copies).
   */
  private async enrichMovie(
    movie: DispatcharrMovie,
    catalogueLanguage: string | undefined,
    languageConfidence: PlayableLanguageConfidence,
    languages: string[],
  ): Promise<Media | null> {
    const http = await this.http();
    let candidates: DispatcharrStreamCandidate[] = [];
    // List endpoint usually leaves duration_secs null — provider payloads carry it.
    let durationSecs = movie.duration_secs ?? null;

    // Fetch in parallel: provider-info is small; /providers/ is large but needed for
    // multi-stream language ranking.
    const [providersSettled, infoSettled] = await Promise.allSettled([
      http.request<unknown>("GET", `/api/vod/movies/${movie.id}/providers/`, {
        allowStatuses: [200, 404],
      }),
      http.request<unknown>("GET", `/api/vod/movies/${movie.id}/provider-info/`, {
        allowStatuses: [200, 404],
      }),
    ]);

    if (providersSettled.status === "fulfilled" && providersSettled.value.status === 200) {
      const providersParsed = ProvidersSchema.safeParse(providersSettled.value.data);
      if (providersParsed.success && providersParsed.data.length > 0) {
        const providers = providersParsed.data;
        const titleHints = parseCatalogueLanguageHints({ name: movie.name });
        candidates = providers.map((p) => {
          const categoryName = p.category?.name;
          const basicName = p.custom_properties?.basic_data?.name;
          // Language lives on category / XC title — never m3u account ("Strong 8K").
          const hints = parseCatalogueLanguageHints({
            name: categoryName ?? basicName,
            group: basicName ?? movie.name,
          });
          const qualityLabel = p.quality_info?.quality ?? p.quality_info?.resolution ?? undefined;
          const fromQi = parseQualityHints(qualityLabel);
          const fromLabel = parseQualityHints([categoryName, basicName, movie.name].filter(Boolean).join(" "));
          const resolutionHeight =
            fromQi.height ?? hints.qualityHeight ?? fromLabel.height ?? titleHints.qualityHeight;
          const hdr = Boolean(fromQi.hdr ?? hints.hdr ?? fromLabel.hdr ?? titleHints.hdr);
          return {
            streamId: p.stream_id ?? undefined,
            m3uAccountId: p.m3u_account?.id,
            label: categoryName ?? basicName ?? qualityLabel,
            catalogueLanguage: hints.language,
            qualityLabel,
            resolutionHeight,
            hdr: hdr || undefined,
          };
        });
        if (durationSecs == null) {
          for (const p of providers) {
            const nested = p.movie?.duration_secs;
            if (nested != null && nested > 0) {
              durationSecs = nested;
              break;
            }
          }
        }
      }
    }

    if (infoSettled.status === "fulfilled" && infoSettled.value.status === 200) {
      const infoParsed = DispatcharrMovieProviderInfoSchema.safeParse(infoSettled.value.data);
      if (infoParsed.success) {
        const info = infoParsed.data;
        if (candidates.length === 0 && info.stream_id) {
          const hints = parseCatalogueLanguageHints({ name: info.name ?? movie.name });
          candidates = [
            {
              streamId: info.stream_id,
              label: info.name,
              catalogueLanguage: hints.language,
              resolutionHeight: hints.qualityHeight,
              hdr: hints.hdr,
            },
          ];
        }
        if (durationSecs == null && info.duration_secs != null && info.duration_secs > 0) {
          durationSecs = info.duration_secs;
        }
      }
    }

    const ranked = rankDispatcharrStreamCandidates(candidates, languages, {
      untaggedPlayable: isPlayableLanguageConfidence(languageConfidence),
    });
    if (candidates.length > 0 && ranked.length === 0) return null;

    return mapMovieToMedia(
      durationSecs != null ? { ...movie, duration_secs: durationSecs } : movie,
      {
        candidates: ranked,
        catalogueLanguage:
          catalogueLanguage ?? parseCatalogueLanguageHints({ name: movie.name }).language,
        languageConfidence,
      },
    );
  }

  /** Expose for tests / indexers */
  clearCache(): void {
    this.tmdbCache.clear();
    this.groupsCache = undefined;
    this.channelsCache = undefined;
  }

  /**
   * One page of the VOD movie or series catalogue (for background indexing).
   * Rows without a TMDb id are omitted — Reclinarr joins catalogues via TMDb.
   */
  async pageVodCatalogue(
    mediaType: "movie" | "tv",
    opts?: { page?: number; pageSize?: number },
  ): Promise<{
    items: Array<{ id: number; uuid: string; name: string; tmdbId: number }>;
    count: number;
    page: number;
    pageSize: number;
    /** Raw rows on this page before TMDb filtering (0 ⇒ end of catalogue). */
    rawCount: number;
  }> {
    const page = Math.max(1, opts?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 100));
    return this.withAuthRetry(async (http) => {
      const path = mediaType === "movie" ? "/api/vod/movies/" : "/api/vod/series/";
      const schema = mediaType === "movie" ? MoviesPageSchema : SeriesPageSchema;
      const { data } = await http.request("GET", path, {
        query: { page, page_size: pageSize },
        schema,
      });
      const rows = data.results ?? [];
      const items: Array<{ id: number; uuid: string; name: string; tmdbId: number }> = [];
      for (const row of rows) {
        const tmdbId = parseTmdbId(row.tmdb_id);
        if (tmdbId == null) continue;
        items.push({ id: row.id, uuid: row.uuid, name: row.name, tmdbId });
      }
      return {
        items,
        count: data.count ?? rows.length,
        page,
        pageSize,
        rawCount: rows.length,
      };
    });
  }

  /** Used when availability already carries uuid (e.g. from details merge). */
  async resolvePlaybackFromUuid(
    uuid: string,
    kind: "movie" | "episode",
    streamId?: string,
    opts?: { durationSeconds?: number },
  ): Promise<PlaybackSource> {
    const qs = new URLSearchParams({ kind });
    if (streamId) qs.set("streamId", streamId);
    // Relative same-origin URL — browser/Vite proxy; workers need absolutizing client-side.
    return {
      provider: "dispatcharr",
      delivery: {
        mode: "proxy",
        url: `/api/playback/dispatcharr/vod/${encodeURIComponent(uuid)}?${qs}`,
      },
      directPlay: true,
      mimeType: "video/mp4",
      ...(opts?.durationSeconds != null && opts.durationSeconds > 0
        ? { durationSeconds: opts.durationSeconds }
        : {}),
    };
  }

  async listChannelGroups(): Promise<LiveChannelGroup[]> {
    const now = Date.now();
    if (this.groupsCache && now - this.groupsCache.at < 60_000) {
      return this.groupsCache.items;
    }
    const http = await this.http();
    const { data } = await http.request("GET", "/api/channels/groups/", {
      schema: GroupsSchema,
    });
    const raw = Array.isArray(data) ? data : (data.results ?? []);
    const items = raw.map((g) => ({ id: String(g.id), name: g.name }));
    this.groupsCache = { at: now, items };
    return items;
  }

  async listChannels(opts?: {
    groupId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    favouritesOnly?: boolean;
    favouriteUuids?: string[];
    sort?: "number" | "name" | "name_desc";
  }): Promise<{ items: LiveChannel[]; total: number }> {
    const page = Math.max(1, opts?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 50));
    const search = opts?.search?.trim();
    const favouriteSet = new Set(opts?.favouriteUuids ?? []);
    const sort = opts?.sort ?? "number";

    // Upstream group filters are unreliable — cache + filter locally for small catalogues.
    const all = await this.loadAllChannels();
    let filtered = all;
    if (opts?.favouritesOnly) {
      filtered = filtered.filter((c) => favouriteSet.has(c.uuid));
    } else if (opts?.groupId) {
      filtered = filtered.filter((c) => c.groupId === opts.groupId);
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          String(c.number ?? "").includes(q) ||
          (c.tvgId?.toLowerCase().includes(q) ?? false),
      );
    }

    filtered = [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "name_desc") return b.name.localeCompare(a.name);
      return (a.number ?? 1e9) - (b.number ?? 1e9) || a.name.localeCompare(b.name);
    });

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize).map((c) => ({
      ...c,
      favourite: favouriteSet.has(c.uuid),
    }));
    return { items, total };
  }

  async getChannel(uuid: string): Promise<LiveChannel | null> {
    const all = await this.loadAllChannels();
    return all.find((c) => c.uuid === uuid) ?? null;
  }

  async getNowNext(channelUuids: string[]): Promise<LiveNowNext[]> {
    const uuids = [...new Set(channelUuids)].slice(0, 80);
    if (uuids.length === 0) return [];

    const channels = await this.loadAllChannels();
    const byUuid = new Map(channels.map((c) => [c.uuid, c]));

    // Prefer dedicated current-programs endpoint (batch).
    try {
      const http = await this.http();
      const { data } = await http.request("POST", "/api/epg/current-programs/", {
        body: { channel_uuids: uuids },
        schema: ProgramsListSchema,
        allowStatuses: [200],
      });
      if (data.length > 0) {
        const nowByUuid = new Map<string, EpgProgramme>();
        for (const p of data) {
          const uuid = p.channel_uuid ?? undefined;
          if (!uuid) continue;
          nowByUuid.set(uuid, this.mapProgram(p, uuid));
        }
        // Current-programs has no "next" — fill from a short grid window.
        const nextByUuid = await this.nextFromGuideWindow(uuids, byUuid).catch(
          () => new Map<string, EpgProgramme>(),
        );
        return uuids.map((uuid) => ({
          channelUuid: uuid,
          now: nowByUuid.get(uuid) ?? null,
          next: nextByUuid.get(uuid) ?? null,
        }));
      }
    } catch {
      // fall through to grid window
    }

    // Fallback: short EPG grid window keyed by tvg_id.
    return this.nowNextFromGuideWindow(uuids, byUuid);
  }

  private async nextFromGuideWindow(
    uuids: string[],
    byUuid: Map<string, LiveChannel>,
  ): Promise<Map<string, EpgProgramme>> {
    const rows = await this.nowNextFromGuideWindow(uuids, byUuid);
    return new Map(
      rows
        .filter((r) => r.next)
        .map((r) => [r.channelUuid, r.next!] as const),
    );
  }

  private async nowNextFromGuideWindow(
    uuids: string[],
    byUuid: Map<string, LiveChannel>,
  ): Promise<LiveNowNext[]> {
    const guide = await this.getGuideWindow({
      start: new Date(Date.now() - 30 * 60_000).toISOString(),
      end: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
    });
    const byTvg = new Map<string, EpgProgramme[]>();
    for (const p of guide) {
      const key = p.channelId;
      const list = byTvg.get(key) ?? [];
      list.push(p);
      byTvg.set(key, list);
    }
    const nowMs = Date.now();
    return uuids.map((uuid) => {
      const ch = byUuid.get(uuid);
      const tvg = ch?.tvgId;
      const programs = (tvg ? byTvg.get(tvg) : undefined) ?? [];
      const sorted = [...programs].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const now =
        sorted.find((p) => {
          const s = Date.parse(p.startsAt);
          const e = Date.parse(p.endsAt);
          return s <= nowMs && e > nowMs;
        }) ?? null;
      const next =
        sorted.find((p) => Date.parse(p.startsAt) > (now ? Date.parse(now.endsAt) : nowMs)) ??
        null;
      return {
        channelUuid: uuid,
        now: now ? { ...now, channelUuid: uuid } : null,
        next: next ? { ...next, channelUuid: uuid } : null,
      };
    });
  }

  async getGuideWindow(opts: { start: string; end: string }): Promise<EpgProgramme[]> {
    await this.ensureJwt();
    if (!this.auth) {
      throw new ProviderError("Dispatcharr auth not configured", {
        code: "unauthorized",
        provider: this.id,
      });
    }
    // Grid payloads are large — use a longer timeout than catalogue calls.
    const http = new HttpClient({
      baseUrl: this.baseUrl,
      timeoutMs: Math.max(this.timeoutMs, 60_000),
      serviceName: "dispatcharr",
      fetchImpl: this.fetchImpl,
      defaultHeaders: {
        ...this.gateHeaders(),
        ...authHeaders(this.auth, this.accessToken),
      },
    });
    const { data } = await http.request("GET", "/api/epg/grid/", {
      query: { start: opts.start, end: opts.end },
      schema: GridSchema,
    });
    return (data.data ?? []).map((p) => this.mapProgram(p));
  }

  async resolveLivePlayback(channelUuid: string): Promise<PlaybackSource | null> {
    if (!channelUuid) return null;
    // Always relative so the browser stays same-origin (Vite proxy / Reclinarr host)
    // and session cookies + CORS never break live MSE playback.
    return {
      provider: "dispatcharr",
      delivery: {
        mode: "proxy",
        url: `/api/playback/dispatcharr/live/${encodeURIComponent(channelUuid)}`,
      },
      directPlay: true,
      mimeType: "video/mp2t",
      hls: false,
    };
  }

  /**
   * Authenticated live TS URL + headers for nginx X-Accel-Redirect.
   * Token stays server-side in the accel path.
   */
  async resolveLiveStreamTarget(input: {
    uuid: string;
  }): Promise<{ url: string; headers: Record<string, string> }> {
    await this.ensureJwt();
    if (!this.auth) {
      throw new ProviderError("Dispatcharr auth not configured", {
        code: "unauthorized",
        provider: this.id,
      });
    }

    const path = `/proxy/ts/stream/${encodeURIComponent(input.uuid)}`;
    const url = new URL(this.baseUrl + path);
    if (this.accessToken) url.searchParams.set("token", this.accessToken);

    return {
      url: url.toString(),
      headers: {
        ...this.gateHeaders(),
        ...authHeaders(this.auth, this.accessToken),
      },
    };
  }

  /** Open upstream Dispatcharr live MPEG-TS proxy with Reclinarr-held auth. */
  async openLiveStream(input: {
    uuid: string;
    signal?: AbortSignal;
  }): Promise<Response> {
    const target = await this.resolveLiveStreamTarget({ uuid: input.uuid });
    const res = await (this.fetchImpl ?? fetch)(target.url, {
      headers: target.headers,
      signal: input.signal,
      redirect: "follow",
    });

    if ((res.status === 401 || res.status === 302) && this.auth?.type === "credentials") {
      await this.ensureJwt(true);
      const retried = await this.resolveLiveStreamTarget({ uuid: input.uuid });
      return (this.fetchImpl ?? fetch)(retried.url, {
        headers: retried.headers,
        signal: input.signal,
        redirect: "follow",
      });
    }
    return res;
  }

  async openLogo(logoId: number, signal?: AbortSignal): Promise<Response> {
    await this.ensureJwt();
    if (!this.auth) {
      throw new ProviderError("Dispatcharr auth not configured", {
        code: "unauthorized",
        provider: this.id,
      });
    }
    const url = new URL(`${this.baseUrl}/api/channels/logos/${logoId}/cache/`);
    return (this.fetchImpl ?? fetch)(url, {
      headers: {
        ...this.gateHeaders(),
        ...authHeaders(this.auth, this.accessToken),
      },
      signal,
      redirect: "follow",
    });
  }

  private async loadAllChannels(): Promise<LiveChannel[]> {
    const now = Date.now();
    if (this.channelsCache && now - this.channelsCache.at < 60_000) {
      return this.channelsCache.items;
    }

    const groups = await this.listChannelGroups();
    const groupNames = new Map(groups.map((g) => [g.id, g.name]));
    const http = await this.http();
    const items: LiveChannel[] = [];
    let page = 1;
    let totalPages = 1;

    // Cap pages high enough for large lineups (100 × 200 = 20k channels).
    while (page <= totalPages && page <= 200) {
      const { data } = await http.request("GET", "/api/channels/channels/", {
        query: { page, page_size: 100 },
        schema: ChannelsPageSchema,
      });
      const results = data.results ?? [];
      for (const ch of results) {
        if (ch.hidden_from_output) continue;
        items.push(this.mapChannel(ch, groupNames));
      }
      const count = data.count ?? items.length;
      totalPages = Math.max(1, Math.ceil(count / 100));
      if (results.length === 0) break;
      page += 1;
    }

    items.sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.name.localeCompare(b.name));
    this.channelsCache = { at: now, items };
    return items;
  }

  private mapChannel(
    ch: DispatcharrChannel,
    groupNames: Map<string, string>,
  ): LiveChannel {
    const groupId = String(
      ch.effective_channel_group_id ?? ch.channel_group_id ?? "",
    );
    const logoId = ch.effective_logo_id ?? ch.logo_id;
    const numberRaw = ch.effective_channel_number ?? ch.channel_number;
    const number =
      typeof numberRaw === "number"
        ? numberRaw
        : numberRaw != null
          ? Number(numberRaw)
          : undefined;

    return {
      id: String(ch.id),
      uuid: ch.uuid,
      name: ch.effective_name || ch.name,
      number: Number.isFinite(number) ? number : undefined,
      groupId: groupId || undefined,
      groupName: groupId ? groupNames.get(groupId) : undefined,
      tvgId: ch.effective_tvg_id ?? ch.tvg_id ?? undefined,
      // Relative so the browser hits Reclinarr (Vite proxy / same origin).
      logoUrl: logoId ? `/api/images/dispatcharr/logo/${logoId}` : undefined,
    };
  }

  private mapProgram(
    p: z.infer<typeof DispatcharrProgramSchema>,
    channelUuid?: string,
  ): EpgProgramme {
    return {
      id: p.id != null ? String(p.id) : undefined,
      channelId: p.tvg_id ?? channelUuid ?? "unknown",
      channelUuid: p.channel_uuid ?? channelUuid ?? undefined,
      title: p.title,
      description: p.description ?? undefined,
      startsAt: p.start_time,
      endsAt: p.end_time,
      isLive: p.is_live,
    };
  }
}

function mediaDurationSeconds(media: Media | null | undefined): number | undefined {
  if (!media) return undefined;
  const exact = media.metadata.durationSeconds;
  if (exact != null && exact > 0) return exact;
  const mins = media.metadata.runtimeMinutes;
  if (mins != null && mins > 0) return mins * 60;
  return undefined;
}

export type { DispatcharrAuth };
export type { DispatcharrMovie, DispatcharrSeries };
