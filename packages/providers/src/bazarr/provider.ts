import type { ProviderHealth, SubtitleTrack } from "@reclinarr/shared";
import { ProviderError } from "@reclinarr/shared";
import { z } from "zod";
import { HttpClient } from "../http.js";
import type { MediaProvider } from "../types.js";
import { BAZARR_CAPABILITIES } from "../types.js";
import { matchEpisode, matchMovie, matchSeries } from "./match.js";

const SUBTITLE_EXTENSIONS = new Set([".srt", ".vtt", ".ass", ".ssa"]);
const MAX_SUBTITLE_CHARS = 5_000_000;
const LIST_TTL_MS = 5 * 60_000;

const RawSubtitleSchema = z
  .object({
    name: z.string().nullable().optional(),
    code2: z.string().nullable().optional(),
    path: z.string().nullable().optional(),
    forced: z.boolean().optional(),
    hi: z.boolean().optional(),
  })
  .passthrough();
type RawSubtitle = z.infer<typeof RawSubtitleSchema>;

const MovieSchema = z
  .object({
    radarrId: z.number(),
    title: z.string().nullable().optional(),
    year: z.union([z.string(), z.number()]).nullable().optional(),
    imdbId: z.string().nullable().optional(),
    subtitles: z.unknown().optional(),
  })
  .passthrough();
type BazarrMovie = z.infer<typeof MovieSchema>;

const SeriesSchema = z
  .object({
    sonarrSeriesId: z.number(),
    title: z.string().nullable().optional(),
    year: z.union([z.string(), z.number()]).nullable().optional(),
    imdbId: z.string().nullable().optional(),
    tvdbId: z.union([z.number(), z.string()]).nullable().optional(),
  })
  .passthrough();
type BazarrSeries = z.infer<typeof SeriesSchema>;

const EpisodeSchema = z
  .object({
    sonarrEpisodeId: z.number(),
    season: z.number().nullable().optional(),
    episode: z.number().nullable().optional(),
    subtitles: z.unknown().optional(),
  })
  .passthrough();
type BazarrEpisode = z.infer<typeof EpisodeSchema>;

const StatusSchema = z
  .object({
    data: z
      .object({
        bazarr_version: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface BazarrSubtitleQuery {
  mediaType: "movie" | "episode";
  imdbId?: string;
  tvdbId?: number;
  title?: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface BazarrProviderOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class BazarrProvider implements MediaProvider {
  readonly id = "bazarr";
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  private moviesCache: { at: number; movies: BazarrMovie[] } | null = null;
  private seriesCache: { at: number; series: BazarrSeries[] } | null = null;
  private episodeCache = new Map<number, { at: number; episodes: BazarrEpisode[] }>();
  /** External subtitle rows from the last lookup, keyed `movie:id` / `episode:id`. */
  private externalByKey = new Map<string, RawSubtitle[]>();

  constructor(opts: BazarrProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl;
  }

  capabilities() {
    return BAZARR_CAPABILITIES;
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  private http(): HttpClient {
    if (!this.baseUrl) {
      throw new ProviderError("BAZARR_URL not set", {
        code: "unavailable",
        provider: this.id,
      });
    }
    return new HttpClient({
      baseUrl: this.baseUrl,
      timeoutMs: Math.max(this.timeoutMs, 30_000),
      serviceName: "bazarr",
      fetchImpl: this.fetchImpl,
      defaultHeaders: this.apiKey ? { "X-API-KEY": this.apiKey } : {},
    });
  }

  async health(): Promise<ProviderHealth> {
    if (!this.baseUrl) {
      return {
        id: this.id,
        status: "unconfigured",
        message: "BAZARR_URL not set",
        capabilities: this.capabilities(),
      };
    }
    if (!this.apiKey) {
      return {
        id: this.id,
        status: "unconfigured",
        message: "BAZARR_API_KEY not set",
        capabilities: this.capabilities(),
      };
    }
    const started = Date.now();
    try {
      const { data } = await this.http().request("GET", "/api/system/status", {
        schema: StatusSchema,
      });
      return {
        id: this.id,
        status: "ok",
        latencyMs: Date.now() - started,
        message: data.data?.bazarr_version,
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

  async listSubtitles(query: BazarrSubtitleQuery): Promise<SubtitleTrack[]> {
    if (!this.isConfigured()) return [];
    if (query.mediaType === "movie") {
      const movie = matchMovie(await this.movies(), query);
      if (!movie) return [];
      return await this.tracksFor("movie", movie.radarrId, parseSubtitles(movie.subtitles));
    }

    const show = matchSeries(await this.series(), query);
    if (!show) return [];
    const episode = matchEpisode(
      await this.episodes(show.sonarrSeriesId),
      query.seasonNumber,
      query.episodeNumber,
    );
    if (!episode) return [];
    return await this.tracksFor(
      "episode",
      episode.sonarrEpisodeId,
      parseSubtitles(episode.subtitles),
      show.sonarrSeriesId,
    );
  }

  /** Subtitle text from Bazarr over HTTP. Bazarr reads its own library; Reclinarr never touches local disk. */
  async readSubtitle(
    kind: "movie" | "episode",
    mediaId: number,
    index: number,
    seriesId?: number,
  ): Promise<string | null> {
    if (!this.isConfigured()) return null;
    let external = this.externalByKey.get(`${kind}:${mediaId}`);
    if (!external && kind === "movie") {
      const movie = (await this.movies()).find((item) => item.radarrId === mediaId);
      external = externalSubtitles(parseSubtitles(movie?.subtitles));
      this.externalByKey.set(`${kind}:${mediaId}`, external);
    }
    if (!external && kind === "episode" && seriesId != null) {
      const episode = (await this.episodes(seriesId)).find(
        (item) => item.sonarrEpisodeId === mediaId,
      );
      external = externalSubtitles(parseSubtitles(episode?.subtitles));
      this.externalByKey.set(`${kind}:${mediaId}`, external);
    }
    const hit = external?.[index];
    if (!hit?.path) return null;
    const { data } = await this.http().request<unknown>("GET", "/api/subtitles/contents", {
      query: { subtitlePath: hit.path },
    });
    const text = bazarrContentsToWebVtt(data);
    if (!text || text.length > MAX_SUBTITLE_CHARS) return null;
    return text;
  }

  private async tracksFor(
    kind: "movie" | "episode",
    mediaId: number,
    subs: RawSubtitle[],
    seriesId?: number,
  ): Promise<SubtitleTrack[]> {
    const external = externalSubtitles(subs);
    this.externalByKey.set(`${kind}:${mediaId}`, external);
    const tracks: SubtitleTrack[] = [];
    for (let index = 0; index < external.length; index += 1) {
      const sub = external[index];
      if (!sub?.path) continue;
      const url =
        kind === "episode" && seriesId != null
          ? `/api/playback/bazarr/episode/${seriesId}/${mediaId}/${index}`
          : `/api/playback/bazarr/movie/${mediaId}/${index}`;
      tracks.push({
        index,
        language: sub.code2 ?? undefined,
        label: subtitleLabel(sub),
        forced: Boolean(sub.forced),
        hearingImpaired: Boolean(sub.hi),
        url,
      });
    }
    return tracks;
  }

  private async movies(): Promise<BazarrMovie[]> {
    if (this.moviesCache && Date.now() - this.moviesCache.at < LIST_TTL_MS) {
      return this.moviesCache.movies;
    }
    const { data } = await this.http().request("GET", "/api/movies", {
      query: { start: 0, length: -1 },
      schema: z.object({ data: z.array(MovieSchema) }).passthrough(),
    });
    this.moviesCache = { at: Date.now(), movies: data.data };
    return data.data;
  }

  private async series(): Promise<BazarrSeries[]> {
    if (this.seriesCache && Date.now() - this.seriesCache.at < LIST_TTL_MS) {
      return this.seriesCache.series;
    }
    const { data } = await this.http().request("GET", "/api/series", {
      query: { start: 0, length: -1 },
      schema: z.object({ data: z.array(SeriesSchema) }).passthrough(),
    });
    this.seriesCache = { at: Date.now(), series: data.data };
    return data.data;
  }

  private async episodes(seriesId: number): Promise<BazarrEpisode[]> {
    const cached = this.episodeCache.get(seriesId);
    if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.episodes;
    const { data } = await this.http().request("GET", "/api/episodes", {
      query: { "seriesid[]": seriesId },
      schema: z.object({ data: z.array(EpisodeSchema) }).passthrough(),
    });
    this.episodeCache.set(seriesId, { at: Date.now(), episodes: data.data });
    return data.data;
  }

}

function parseSubtitles(value: unknown): RawSubtitle[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const subs: RawSubtitle[] = [];
  for (const item of raw) {
    const parsed = RawSubtitleSchema.safeParse(item);
    if (parsed.success) subs.push(parsed.data);
  }
  return subs;
}

function externalSubtitles(subs: RawSubtitle[]): RawSubtitle[] {
  return subs
    .filter((sub) => {
      if (!sub.path) return false;
      return SUBTITLE_EXTENSIONS.has(subtitleExtension(sub.path));
    })
    .sort((a, b) => {
      const byName = (a.name ?? "").localeCompare(b.name ?? "");
      if (byName !== 0) return byName;
      return Number(Boolean(a.forced)) - Number(Boolean(b.forced));
    });
}

function subtitleExtension(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

function subtitleLabel(sub: RawSubtitle): string {
  const base = sub.name || sub.code2 || "Subtitles";
  const tags = [sub.hi ? "SDH" : null, sub.forced ? "Forced" : null].filter(
    (tag): tag is string => Boolean(tag),
  );
  return tags.length ? `${base} · ${tags.join(" · ")}` : base;
}

const CueTimeSchema = z
  .object({
    total_seconds: z.number(),
    microseconds: z.number().optional(),
  })
  .passthrough();

const ContentsSchema = z
  .object({
    data: z.array(
      z
        .object({
          content: z.string(),
          start: CueTimeSchema,
          end: CueTimeSchema,
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** Bazarr `GET /api/subtitles/contents` returns cue JSON. Older builds may return raw SRT/VTT text. */
export function bazarrContentsToWebVtt(payload: unknown): string | null {
  if (typeof payload === "string") {
    const text = payload.trim();
    return text ? text : null;
  }
  const parsed = ContentsSchema.safeParse(payload);
  if (!parsed.success) return null;
  const blocks: string[] = [];
  for (const cue of parsed.data.data) {
    const start = cueSeconds(cue.start);
    const end = cueSeconds(cue.end);
    const text = cue.content.replace(/\r/g, "").trim();
    if (!text || !(end > start)) continue;
    blocks.push(`${formatCueTime(start)} --> ${formatCueTime(end)}\n${text}`);
  }
  if (!blocks.length) return null;
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

function cueSeconds(part: { total_seconds: number; microseconds?: number }): number {
  return part.total_seconds + (part.microseconds ?? 0) / 1_000_000;
}

function formatCueTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}
