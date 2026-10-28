import type { Media, MediaIdentity, ProviderHealth } from "@reclinarr/shared";
import { ProviderError } from "@reclinarr/shared";
import { HttpClient } from "../http.js";
import type { DiscoveryProvider, MediaRequestSummary, RequestProvider } from "../types.js";
import { SEERR_CAPABILITIES } from "../types.js";
import { identityNeedsTmdb, mapMediaInfoToRequestAvailability, mapMovieDetailsToMedia, mapSearchResultToMedia, mapSeerrEpisodeToMedia, mapTvDetailsToMedia } from "./map.js";
import {
  MEDIA_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  SeerrMovieDetailsSchema,
  SeerrRequestListSchema,
  SeerrResultsPageSchema,
  SeerrTvDetailsSchema,
  SeerrTvSeasonSchema,
  SeerrUserListSchema,
  type SeerrMediaRequest,
  type SeerrSearchResult,
  type SeerrTvDetails,
} from "./schemas.js";
import { z } from "zod";

export interface SeerrProviderOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const StatusSchema = z
  .object({
    version: z.string().optional(),
  })
  .passthrough();

export class SeerrProvider implements DiscoveryProvider, RequestProvider {
  readonly id = "seerr";
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private seerrUsers: { at: number; byJellyfin: Map<string, number> } | null = null;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: SeerrProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl;
  }

  capabilities() {
    return SEERR_CAPABILITIES;
  }

  private http(): HttpClient {
    if (!this.baseUrl) {
      throw new ProviderError("SEERR_URL not set", {
        code: "unavailable",
        provider: this.id,
      });
    }
    return new HttpClient({
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      serviceName: "seerr",
      fetchImpl: this.fetchImpl,
      defaultHeaders: this.apiKey ? { "X-Api-Key": this.apiKey } : {},
    });
  }

  async health(): Promise<ProviderHealth> {
    if (!this.baseUrl) {
      return {
        id: this.id,
        status: "unconfigured",
        message: "SEERR_URL not set",
        capabilities: this.capabilities(),
      };
    }
    const started = Date.now();
    try {
      await this.http().request("GET", "/api/v1/status", { schema: StatusSchema });
      return {
        id: this.id,
        status: "ok",
        latencyMs: Date.now() - started,
        message: this.apiKey ? undefined : "SEERR_API_KEY not set — discovery/request may fail",
        capabilities: this.capabilities(),
      };
    } catch (err) {
      return {
        id: this.id,
        status: "down",
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : String(err),
        capabilities: this.capabilities(),
      };
    }
  }

  async discoverTrending(opts?: { page?: number; mediaType?: "movie" | "tv" }): Promise<Media[]> {
    const { data } = await this.http().request("GET", "/api/v1/discover/trending", {
      query: {
        page: opts?.page ?? 1,
        mediaType: opts?.mediaType,
        timeWindow: "week",
      },
      schema: SeerrResultsPageSchema,
    });
    return this.mapResults(data.results ?? []);
  }

  async discoverMovies(opts?: { page?: number; genreId?: number }): Promise<Media[]> {
    const query: Record<string, string | number> = { page: opts?.page ?? 1 };
    if (opts?.genreId != null && opts.genreId > 0) query.genre = opts.genreId;
    const { data } = await this.http().request("GET", "/api/v1/discover/movies", {
      query,
      schema: SeerrResultsPageSchema,
    });
    return this.mapResults(data.results ?? []);
  }

  async discoverTv(opts?: { page?: number; genreId?: number }): Promise<Media[]> {
    const query: Record<string, string | number> = { page: opts?.page ?? 1 };
    if (opts?.genreId != null && opts.genreId > 0) query.genre = opts.genreId;
    const { data } = await this.http().request("GET", "/api/v1/discover/tv", {
      query,
      schema: SeerrResultsPageSchema,
    });
    return this.mapResults(data.results ?? []);
  }

  async search(query: string, opts?: { page?: number }): Promise<Media[]> {
    const q = query.trim();
    if (!q) return [];
    const { data } = await this.http().request("GET", "/api/v1/search", {
      query: { query: q, page: opts?.page ?? 1 },
      schema: SeerrResultsPageSchema,
    });
    return this.mapResults(data.results ?? []);
  }

  async getDetails(mediaType: "movie" | "tv", tmdbId: number): Promise<Media | null> {
    try {
      if (mediaType === "movie") {
        const { data } = await this.http().request(
          "GET",
          `/api/v1/movie/${encodeURIComponent(String(tmdbId))}`,
          { schema: SeerrMovieDetailsSchema },
        );
        return mapMovieDetailsToMedia(data);
      }
      const { data } = await this.http().request(
        "GET",
        `/api/v1/tv/${encodeURIComponent(String(tmdbId))}`,
        { schema: SeerrTvDetailsSchema },
      );
      return mapTvDetailsToMedia(data);
    } catch (err) {
      if (err instanceof ProviderError && err.code === "not_found") return null;
      throw err;
    }
  }

  async getSimilar(
    mediaType: "movie" | "tv",
    tmdbId: number,
    opts?: { page?: number },
  ): Promise<Media[]> {
    const page = opts?.page ?? 1;
    const base = mediaType === "movie" ? "movie" : "tv";
    const id = encodeURIComponent(String(tmdbId));
    // Prefer similar; fall back to recommendations (Jellyseerr/Overseerr both expose these).
    for (const kind of ["similar", "recommendations"] as const) {
      try {
        const { data } = await this.http().request(
          "GET",
          `/api/v1/${base}/${id}/${kind}`,
          {
            query: { page },
            schema: SeerrResultsPageSchema,
          },
        );
        const items = this.mapResults(data.results ?? []);
        if (items.length > 0) return items;
      } catch {
        // try next kind
      }
    }
    return [];
  }

  /**
   * Full TMDb episode guide from Seerr. This is the series page spine:
   * an episode can be missing from Jellyfin and still be listed, then
   * marked playable when IPTV VOD has that SxxExx.
   */
  async listTvEpisodes(tmdbId: number): Promise<Media[]> {
    const { data } = await this.http().request(
      "GET",
      `/api/v1/tv/${encodeURIComponent(String(tmdbId))}`,
      { schema: SeerrTvDetailsSchema },
    );
    const seasonNumbers = seasonNumbersFromDetails(data);
    if (seasonNumbers.length === 0) return [];

    const seasonStatus = new Map<number, number>();
    for (const season of data.mediaInfo?.seasons ?? []) {
      if (season.status != null) seasonStatus.set(season.seasonNumber, season.status);
    }
    const seriesStatus = data.mediaInfo?.status;

    const lists = await mapPool(seasonNumbers, 4, async (seasonNumber) => {
      try {
        const { data: season } = await this.http().request(
          "GET",
          `/api/v1/tv/${encodeURIComponent(String(tmdbId))}/season/${encodeURIComponent(String(seasonNumber))}`,
          { schema: SeerrTvSeasonSchema },
        );
        const status = seasonStatus.get(seasonNumber) ?? seriesStatus;
        return (season.episodes ?? []).map((episode) =>
          mapSeerrEpisodeToMedia(episode, tmdbId, seasonNumber, status),
        );
      } catch {
        return [];
      }
    });
    return lists.flat();
  }

  async getRequestAvailability(
    identity: MediaIdentity,
  ): Promise<Media["availability"][number] | null> {
    if (!identityNeedsTmdb(identity)) return null;
    const details = await this.getDetails(identity.mediaType, identity.tmdbId);
    if (!details) {
      return {
        provider: "seerr",
        requestable: true,
        mediaStatus: "UNKNOWN",
      };
    }
    return details.availability.find((a) => a.provider === "seerr") ?? null;
  }

  /** IMDb / TVDb / title used to line a title up with Bazarr. */
  async getCatalogIds(
    mediaType: "movie" | "tv",
    tmdbId: number,
  ): Promise<{
    imdbId?: string;
    tvdbId?: number;
    title?: string;
    year?: number;
  } | null> {
    try {
      if (mediaType === "movie") {
        const { data } = await this.http().request(
          "GET",
          `/api/v1/movie/${encodeURIComponent(String(tmdbId))}`,
          { schema: SeerrMovieDetailsSchema },
        );
        return {
          imdbId: cleanExternalId(data.imdbId ?? data.externalIds?.imdbId),
          tvdbId: data.externalIds?.tvdbId ?? data.mediaInfo?.tvdbId ?? undefined,
          title: data.title,
          year: yearFromIso(data.releaseDate),
        };
      }
      const { data } = await this.http().request(
        "GET",
        `/api/v1/tv/${encodeURIComponent(String(tmdbId))}`,
        { schema: SeerrTvDetailsSchema },
      );
      return {
        imdbId: cleanExternalId(data.imdbId ?? data.externalIds?.imdbId),
        tvdbId: data.externalIds?.tvdbId ?? data.mediaInfo?.tvdbId ?? undefined,
        title: data.name,
        year: yearFromIso(data.firstAirDate),
      };
    } catch (err) {
      if (err instanceof ProviderError && err.code === "not_found") return null;
      throw err;
    }
  }

  /**
   * The Seerr account imported for a Jellyfin user (Seerr stores the Jellyfin user id).
   * Cached for a few minutes; a miss refreshes once in case the user was just imported.
   */
  async seerrUserIdForJellyfin(jellyfinUserId: string): Promise<number | null> {
    const key = normalizeJellyfinId(jellyfinUserId);
    const stale = !this.seerrUsers || Date.now() - this.seerrUsers.at > SEERR_USERS_TTL_MS;
    const missRefresh =
      this.seerrUsers && !this.seerrUsers.byJellyfin.has(key) && Date.now() - this.seerrUsers.at > 30_000;
    if (stale || missRefresh) this.seerrUsers = { at: Date.now(), byJellyfin: await this.loadSeerrUsers() };
    return this.seerrUsers!.byJellyfin.get(key) ?? null;
  }

  private async loadSeerrUsers(): Promise<Map<string, number>> {
    const byJellyfin = new Map<string, number>();
    const take = 100;
    for (let page = 0; ; page++) {
      const { data } = await this.http().request("GET", "/api/v1/user", {
        query: { take, skip: page * take },
        schema: SeerrUserListSchema,
      });
      for (const user of data.results) {
        if (user.jellyfinUserId) byJellyfin.set(normalizeJellyfinId(user.jellyfinUserId), user.id);
      }
      if (data.results.length < take || page + 1 >= (data.pageInfo?.pages ?? 1)) return byJellyfin;
    }
  }

  async requestMedia(
    identity: MediaIdentity,
    opts: { asUser: number; seasons?: number[] | "all"; is4k?: boolean },
  ): Promise<void> {
    if (!identityNeedsTmdb(identity)) {
      throw new ProviderError("Seerr request requires tmdbId and movie/tv type", {
        code: "unknown",
        provider: this.id,
        statusCode: 400,
      });
    }

    const body: Record<string, unknown> = {
      mediaType: identity.mediaType,
      mediaId: identity.tmdbId,
      is4k: opts.is4k ?? false,
    };
    if (identity.mediaType === "tv") {
      body.seasons = opts.seasons ?? "all";
    }

    await this.http().request("POST", "/api/v1/request", { body, headers: asUser(opts.asUser) });
  }

  async listRequests(opts: {
    asUser: number;
    take?: number;
    skip?: number;
    filter?: string;
    mediaType?: "movie" | "tv" | "all";
  }): Promise<{ items: MediaRequestSummary[]; total: number }> {
    const { data } = await this.http().request("GET", "/api/v1/request", {
      query: {
        take: opts.take ?? 50,
        skip: opts.skip ?? 0,
        filter: opts.filter ?? "all",
        mediaType: opts.mediaType && opts.mediaType !== "all" ? opts.mediaType : undefined,
        sort: "modified",
        sortDirection: "desc",
      },
      // Seerr shows a user without request-management rights only their own requests.
      headers: asUser(opts.asUser),
      schema: SeerrRequestListSchema,
    });
    const results = data.results ?? [];
    // The request-list payload is already paginated and includes media metadata.
    // Avoid a details request per row: that turned one page into dozens of serial
    // upstream calls and made the list feel unresponsive.
    const items = results.map((r) => this.mapRequestSummary(r));
    return {
      items,
      total: data.pageInfo?.results ?? items.length,
    };
  }

  private mapRequestSummary(req: SeerrMediaRequest): MediaRequestSummary {
    const mediaTypeRaw = (req.type || req.media?.mediaType || "movie").toLowerCase();
    const mediaType: "movie" | "tv" = mediaTypeRaw === "tv" ? "tv" : "movie";
    const tmdbId = req.media?.tmdbId;
    const title = req.media?.title || req.media?.name || `${mediaType === "tv" ? "Series" : "Movie"} ${tmdbId ?? req.id}`;
    const date = mediaType === "tv" ? req.media?.firstAirDate : req.media?.releaseDate;
    const yearMatch = date?.match(/^(\d{4})/);
    const year = yearMatch ? Number(yearMatch[1]) : undefined;
    const posterUrl = req.media?.posterPath
      ? req.media.posterPath.startsWith("http")
        ? req.media.posterPath
        : `https://image.tmdb.org/t/p/w342${req.media.posterPath}`
      : undefined;
    const status =
      REQUEST_STATUS_LABEL[req.status ?? 0] ??
      (req.status != null ? String(req.status) : "UNKNOWN");
    const mediaStatusNum = req.is4k ? req.media?.status4k : req.media?.status;
    const mediaStatus =
      mediaStatusNum != null ? MEDIA_STATUS_LABEL[mediaStatusNum] ?? String(mediaStatusNum) : undefined;
    return {
      id: req.id,
      mediaType,
      tmdbId,
      title,
      year,
      posterUrl,
      status,
      mediaStatus,
      createdAt: req.createdAt,
      is4k: req.is4k,
    };
  }

  /** Expose mapper helper for enrichment without a second HTTP call. */
  mapAvailabilityFromResult(result: SeerrSearchResult) {
    return mapMediaInfoToRequestAvailability(result.mediaInfo);
  }

  private mapResults(results: SeerrSearchResult[]): Media[] {
    const out: Media[] = [];
    for (const result of results) {
      const media = mapSearchResultToMedia(result);
      if (media) out.push(media);
    }
    return out;
  }
}

function cleanExternalId(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function yearFromIso(date?: string | null): number | undefined {
  if (!date || date.length < 4) return undefined;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

function seasonNumbersFromDetails(details: SeerrTvDetails): number[] {
  const fromList = (details.seasons ?? [])
    .filter((season) => season.seasonNumber >= 0 && (season.episodeCount == null || season.episodeCount > 0))
    .map((season) => season.seasonNumber);
  if (fromList.length > 0) return [...new Set(fromList)].sort((a, b) => a - b);
  const count = details.numberOfSeasons ?? 0;
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => i + 1);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

const SEERR_USERS_TTL_MS = 5 * 60 * 1000;

const normalizeJellyfinId = (id: string) => id.replace(/-/g, "").toLowerCase();

/** With the API key, Seerr acts as the user named here instead of the admin (user 1). */
function asUser(seerrUserId: number): Record<string, string> {
  return { "X-API-User": String(seerrUserId) };
}
