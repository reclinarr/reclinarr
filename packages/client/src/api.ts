import type {
  Acquisition,
  EpisodeListItem,
  EpgProgramme,
  LiveChannel,
  LiveChannelGroup,
  LiveNowNext,
  Media,
  MediaIdentity,
  PlaybackResolveResult,
  PlaybackSource,
  SubtitleTrack,
} from "@reclinarr/shared";
import { BW_PROBE_CACHE_KEY, type KeyValueStorage } from "./storage.js";
import { sessionCookieHeader, withCatalogueDuration } from "./playback.js";
import { SESSION_COOKIE } from "./session.js";

export interface LoginResult {
  user: { id: string; username: string };
  sessionId?: string;
}

export interface ReclinarrClientOptions {
  /** Origin of the Reclinarr server, e.g. `http://192.168.1.10:8787`. Empty for same-origin web. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  credentials?: "omit" | "same-origin" | "include";
  getSessionId?: () => string | null | Promise<string | null>;
  setSessionId?: (id: string | null) => void | Promise<void>;
  storage?: KeyValueStorage;
}

const PLAY_BUFFER_POLL_MS = 500;
const PLAY_BUFFER_TIMEOUT_MS = 60_000;
const BW_PROBE_BYTES = 1_500_000;
const BW_PROBE_TTL_MS = 5 * 60_000;
const BW_PROBE_HEADROOM = 0.65;
const BW_MIN = 2_000_000;
const BW_MAX = 20_000_000;

function sessionIdFromSetCookie(header: string | null): string | null {
  if (!header) return null;
  const part = header.split(/,(?=[^ ;]+=)/).find((s) => s.trim().startsWith(`${SESSION_COOKIE}=`));
  const raw = (part ?? header).match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return raw?.[1] ?? null;
}

function clampBitrate(bps: number): number {
  if (!Number.isFinite(bps) || bps <= 0) return 8_000_000;
  return Math.min(BW_MAX, Math.max(BW_MIN, Math.floor(bps)));
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) return {} as T;
  if (trimmed.startsWith("<!") || trimmed.startsWith("<html")) {
    throw new Error(
      "Got an HTML page instead of the API. Point the app at the Reclinarr API (port 8787), not the web UI.",
    );
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      `API returned non-JSON (HTTP ${res.status}). Check that the Reclinarr API is running.`,
    );
  }
}

function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  const origin = baseUrl.replace(/\/$/, "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

function inferDeviceProfile(): "web" | "ios" | "android" {
  try {
    // React Native
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as { Platform?: { OS?: string } };
    if (Platform?.OS === "ios") return "ios";
    if (Platform?.OS === "android") return "android";
  } catch {
    /* web / node */
  }
  return "web";
}

export class ReclinarrClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly credentials?: "omit" | "same-origin" | "include";
  private readonly getSessionId?: ReclinarrClientOptions["getSessionId"];
  private readonly setSessionId?: ReclinarrClientOptions["setSessionId"];
  /** In-memory session so the request after login never races AsyncStorage. */
  private memorySessionId: string | null = null;
  readonly storage?: KeyValueStorage;

  constructor(opts: ReclinarrClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.credentials = opts.credentials;
    this.getSessionId = opts.getSessionId;
    this.setSessionId = opts.setSessionId;
    this.storage = opts.storage;
  }

  url(path: string): string {
    return joinUrl(this.baseUrl, path);
  }

  private async resolveSessionId(): Promise<string | null> {
    if (this.memorySessionId) return this.memorySessionId;
    const fromStore = (await this.getSessionId?.()) ?? null;
    if (fromStore) this.memorySessionId = fromStore;
    return fromStore;
  }

  async sessionHeaders(): Promise<Record<string, string>> {
    return sessionCookieHeader(await this.resolveSessionId());
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const sessionHeaders = await this.sessionHeaders();
    const res = await this.fetchImpl(this.url(path), {
      credentials: this.credentials,
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...sessionHeaders,
        ...init?.headers,
      },
    });
    const data = await parseJsonResponse<T>(res);
    if (!res.ok) {
      const body = data as { error?: string };
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return data;
  }

  async login(input: {
    username: string;
    password: string;
    deviceId: string;
    deviceName: string;
  }) {
    const { data, headers } = await this.requestRaw<LoginResult>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const fromJson = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
    const fromCookie = sessionIdFromSetCookie(headers.get("set-cookie"));
    const sid = fromJson || fromCookie;
    if (!sid) {
      throw new Error(
        `Login response from ${this.baseUrl} had no session id — point the app at the API on port 8787, not Metro/web`,
      );
    }
    if (!this.setSessionId) {
      throw new Error("Login succeeded but the API client has no session storage attached");
    }
    // Memory first — next me()/home() must not wait on AsyncStorage.
    this.memorySessionId = sid;
    data.sessionId = sid;
    await this.setSessionId(sid);
    // Prove this same client instance is accepted before callers navigate away.
    await this.me();
    return data;
  }

  private async requestRaw<T>(
    path: string,
    init?: RequestInit,
  ): Promise<{ data: T; headers: Headers }> {
    const sessionHeaders = await this.sessionHeaders();
    const res = await this.fetchImpl(this.url(path), {
      credentials: this.credentials,
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...sessionHeaders,
        ...init?.headers,
      },
    });
    const data = await parseJsonResponse<T>(res);
    if (!res.ok) {
      const body = data as { error?: string };
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return { data, headers: res.headers };
  }

  async logout() {
    const result = await this.request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
    this.memorySessionId = null;
    await this.setSessionId?.(null);
    return result;
  }

  me() {
    return this.request<{ user: { id: string; username: string }; mocks: boolean }>("/api/auth/me");
  }

  health() {
    return this.request<{ status: string; service: string }>("/api/health");
  }

  healthProviders() {
    return this.request<{
      status: string;
      mocks: boolean;
      providers: Array<{ id: string; status: string; message?: string }>;
    }>("/api/health/providers");
  }

  home() {
    return this.request<{
      rows: Array<{ id: string; title: string; items: Media[] }>;
    }>("/api/home");
  }

  mediaByJellyfin(itemId: string) {
    return this.request<{ media: Media }>(`/api/media/jellyfin/${encodeURIComponent(itemId)}`);
  }

  mediaByTmdb(type: "movie" | "tv", tmdbId: number) {
    return this.request<{ media: Media; iptvResolvePending: boolean }>(
      `/api/media/${type}/${tmdbId}`,
    );
  }

  mediaAvailability(type: "movie" | "tv", tmdbId: number) {
    return this.request<{ media: Media }>(`/api/media/${type}/${tmdbId}/availability`);
  }

  seriesEpisodes(tmdbId: number) {
    return this.request<{
      series: Media;
      seasons: number[];
      items: EpisodeListItem[];
      resumeEpisode?: {
        seasonNumber: number;
        episodeNumber: number;
        positionSeconds: number;
        durationSeconds?: number;
      } | null;
    }>(`/api/media/tv/${tmdbId}/episodes`);
  }

  mediaSimilar(type: "movie" | "tv", tmdbId: number) {
    return this.request<{ items: Media[] }>(`/api/media/${type}/${tmdbId}/similar`);
  }

  myList() {
    return this.request<{ items: Media[]; keys: string[] }>("/api/mylist");
  }

  myListHas(type: "movie" | "tv", tmdbId: number) {
    return this.request<{ onList: boolean }>(
      `/api/mylist/has?type=${type}&tmdbId=${tmdbId}`,
    );
  }

  toggleMyList(type: "movie" | "tv", tmdbId: number) {
    return this.request<{ items: string[]; onList: boolean }>("/api/mylist/toggle", {
      method: "POST",
      body: JSON.stringify({ type, tmdbId }),
    });
  }

  discoverTrending(page = 1, mediaType?: "movie" | "tv") {
    const qs = new URLSearchParams({ page: String(page) });
    if (mediaType) qs.set("mediaType", mediaType);
    return this.request<{ items: Media[] }>(`/api/discover/trending?${qs}`);
  }

  discoverMovies(page = 1, opts?: { genreId?: number }) {
    const qs = new URLSearchParams({ page: String(page) });
    if (opts?.genreId != null) qs.set("genreId", String(opts.genreId));
    return this.request<{ items: Media[] }>(`/api/discover/movies?${qs}`);
  }

  discoverTv(page = 1, opts?: { genreId?: number }) {
    const qs = new URLSearchParams({ page: String(page) });
    if (opts?.genreId != null) qs.set("genreId", String(opts.genreId));
    return this.request<{ items: Media[] }>(`/api/discover/tv?${qs}`);
  }

  catalogRails(mediaType: "movie" | "tv", opts?: { search?: string }) {
    const qs = new URLSearchParams();
    if (opts?.search) qs.set("search", opts.search);
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request<{ rows: Array<{ id: string; title: string; items: Media[] }> }>(
      `/api/catalog/${mediaType}${suffix}`,
    );
  }

  searchMedia(q: string, page = 1) {
    return this.request<{ items: Media[]; query: string }>(
      `/api/search?q=${encodeURIComponent(q)}&page=${page}`,
    );
  }

  requestMedia(
    identity: MediaIdentity,
    opts?: { seasons?: number[] | "all"; is4k?: boolean },
  ) {
    return this.request<{ ok: true; media: Media | null }>("/api/request", {
      method: "POST",
      body: JSON.stringify({
        identity,
        seasons: opts?.seasons,
        is4k: opts?.is4k,
      }),
    });
  }

  startAcquisition(input: {
    identity: MediaIdentity;
    mode?: "cache" | "library";
    source: {
      provider: "dispatcharr";
      movieId?: number;
      episodeId?: number;
      uuid: string;
      streamId?: string;
      m3uAccountId?: number;
    };
  }) {
    return this.request<{ item: Acquisition }>("/api/acquisitions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getAcquisition(id: string) {
    return this.request<{ item: Acquisition }>(`/api/acquisitions/${encodeURIComponent(id)}`);
  }

  cancelAcquisition(id: string) {
    return this.request<{ item: Acquisition }>(
      `/api/acquisitions/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    );
  }

  promoteAcquisition(id: string) {
    return this.request<{ item: Acquisition }>(
      `/api/acquisitions/${encodeURIComponent(id)}/promote`,
      { method: "POST" },
    );
  }

  listAcquisitions() {
    return this.request<{ items: Acquisition[] }>("/api/acquisitions");
  }

  libraryItems(
    mediaType: "movie" | "tv",
    opts?: { startIndex?: number; limit?: number; search?: string },
  ) {
    const qs = new URLSearchParams();
    if (opts?.startIndex != null) qs.set("startIndex", String(opts.startIndex));
    if (opts?.limit != null) qs.set("limit", String(opts.limit));
    if (opts?.search) qs.set("search", opts.search);
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request<{ items: Media[]; total: number }>(`/api/library/${mediaType}${suffix}`);
  }

  listRequests(opts?: {
    take?: number;
    skip?: number;
    filter?: string;
    mediaType?: "movie" | "tv" | "all";
  }) {
    const qs = new URLSearchParams();
    if (opts?.take != null) qs.set("take", String(opts.take));
    if (opts?.skip != null) qs.set("skip", String(opts.skip));
    if (opts?.filter) qs.set("filter", opts.filter);
    if (opts?.mediaType) qs.set("mediaType", opts.mediaType);
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request<{
      items: Array<{
        id: number;
        mediaType: "movie" | "tv";
        tmdbId?: number;
        title: string;
        year?: number;
        posterUrl?: string;
        status: string;
        mediaStatus?: string;
        createdAt?: string;
        is4k?: boolean;
      }>;
      total: number;
    }>(`/api/requests${suffix}`);
  }

  resolvePlayback(
    identity: MediaIdentity,
    opts?: {
      startPositionSeconds?: number;
      audioStreamIndex?: number;
      maxStreamingBitrate?: number;
      deviceProfile?: "web" | "ios" | "android";
    },
  ) {
    return this.request<PlaybackResolveResult>("/api/playback/resolve", {
      method: "POST",
      body: JSON.stringify({
        identity,
        startPositionSeconds: opts?.startPositionSeconds,
        audioStreamIndex: opts?.audioStreamIndex,
        maxStreamingBitrate: opts?.maxStreamingBitrate,
        deviceProfile: opts?.deviceProfile,
      }),
    });
  }

  async measurePlaybackBitrate(itemId?: string): Promise<number | undefined> {
    try {
      const cached = this.storage ? await this.storage.getItem(BW_PROBE_CACHE_KEY) : null;
      if (cached) {
        const parsed = JSON.parse(cached) as { bps?: number; at?: number };
        if (
          parsed.bps &&
          parsed.at &&
          Date.now() - parsed.at < BW_PROBE_TTL_MS &&
          parsed.bps >= BW_MIN
        ) {
          return parsed.bps;
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const qs = itemId ? `?itemId=${encodeURIComponent(itemId)}` : "";
      const t0 =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      const sessionHeaders = await this.sessionHeaders();
      const res = await this.fetchImpl(this.url(`/api/playback/bandwidth-probe${qs}`), {
        credentials: this.credentials,
        headers: {
          Range: `bytes=0-${BW_PROBE_BYTES - 1}`,
          Accept: "application/octet-stream",
          ...sessionHeaders,
        },
      });
      if (!res.ok && res.status !== 206) return undefined;
      const buf = await res.arrayBuffer();
      const elapsed =
        (typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now()) - t0;
      const seconds = Math.max(elapsed / 1000, 0.001);
      if (buf.byteLength < 32_000) return undefined;
      const bps = clampBitrate(((buf.byteLength * 8) / seconds) * BW_PROBE_HEADROOM);
      try {
        await this.storage?.setItem(BW_PROBE_CACHE_KEY, JSON.stringify({ bps, at: Date.now() }));
      } catch {
        /* ignore quota */
      }
      return bps;
    } catch {
      return undefined;
    }
  }

  async resolvePlaybackForPlay(
    identity: MediaIdentity,
    opts?: {
      meta?: { durationSeconds?: number; runtimeMinutes?: number } | null;
      /** Continue Watching / reload resume offset. */
      startPositionSeconds?: number;
      deviceProfile?: "web" | "ios" | "android";
      onBuffering?: (info: {
        acquisitionId: string;
        bytesDownloaded?: number;
        totalBytes?: number;
      }) => void;
    },
  ): Promise<PlaybackSource> {
    const started = Date.now();
    const maxStreamingBitrate = await this.measurePlaybackBitrate(identity.jellyfinItemId);
    const resolveOpts = {
      maxStreamingBitrate,
      startPositionSeconds: opts?.startPositionSeconds,
      deviceProfile: opts?.deviceProfile ?? inferDeviceProfile(),
    };

    const first = await this.resolvePlayback(identity, resolveOpts);
    if (first.status === "ready") {
      return withCatalogueDuration(first.source, opts?.meta);
    }

    const acquisitionId = first.acquisitionId;

    while (Date.now() - started < PLAY_BUFFER_TIMEOUT_MS) {
      const { item } = await this.getAcquisition(acquisitionId);
      if (item.state === "failed" || item.state === "cancelled") {
        throw new Error(
          item.state === "cancelled"
            ? "Download was cancelled"
            : "Download failed — IPTV may be busy (stop Live TV and retry)",
        );
      }
      opts?.onBuffering?.({
        acquisitionId: item.id,
        bytesDownloaded: item.bytesDownloaded,
        totalBytes: item.totalBytes,
      });
      if (item.playbackAvailable) {
        const ready = await this.resolvePlayback(identity, resolveOpts);
        if (ready.status === "ready") {
          return withCatalogueDuration(ready.source, opts?.meta);
        }
      }
      await new Promise((r) => setTimeout(r, PLAY_BUFFER_POLL_MS));
    }

    throw new Error("Timed out waiting for download to become playable");
  }

  listPlaybackSubtitles(
    identity: MediaIdentity,
    opts?: {
      existing?: SubtitleTrack[];
      provider?: PlaybackSource["provider"];
      signal?: AbortSignal;
    },
  ) {
    return this.request<{ subtitles: SubtitleTrack[] }>("/api/playback/subtitles", {
      method: "POST",
      body: JSON.stringify({
        identity,
        existing: opts?.existing,
        provider: opts?.provider,
      }),
      signal: opts?.signal,
    }).then((r) => r.subtitles);
  }

  reportProgress(body: {
    itemId: string;
    positionSeconds: number;
    event: "start" | "progress" | "stopped";
    playSessionId?: string;
    mediaSourceId?: string;
    playMethod?: "DirectPlay" | "DirectStream" | "Transcode";
    isPaused?: boolean;
    /** Used for Reclinarr write-through Continue Watching when Jellyfin is slow/down. */
    identity?: MediaIdentity;
    durationSeconds?: number;
    title?: string;
  }) {
    return this.request<{ ok: boolean }>("/api/playback/progress", {
      method: "POST",
      body: JSON.stringify(body),
    }).catch(() => ({ ok: false as const }));
  }

  reportIptvProgress(body: {
    identity: MediaIdentity;
    positionSeconds: number;
    durationSeconds?: number;
    event?: "start" | "progress" | "stopped";
    title?: string;
  }) {
    return this.request<{ ok: boolean }>("/api/playback/iptv-progress", {
      method: "POST",
      body: JSON.stringify(body),
    }).catch(() => ({ ok: false as const }));
  }

  liveGroups() {
    return this.request<{ items: LiveChannelGroup[] }>("/api/live/groups");
  }

  liveChannels(opts?: {
    groupId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    favouritesOnly?: boolean;
    sort?: "number" | "name" | "name_desc";
  }) {
    const qs = new URLSearchParams();
    if (opts?.groupId) qs.set("groupId", opts.groupId);
    if (opts?.search) qs.set("search", opts.search);
    if (opts?.page) qs.set("page", String(opts.page));
    if (opts?.pageSize) qs.set("pageSize", String(opts.pageSize));
    if (opts?.favouritesOnly) qs.set("favouritesOnly", "1");
    if (opts?.sort && opts.sort !== "number") qs.set("sort", opts.sort);
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request<{ items: LiveChannel[]; total: number; favourites: string[] }>(
      `/api/live/channels${suffix}`,
    );
  }

  liveNow(channelUuids: string[]) {
    return this.request<{ items: LiveNowNext[] }>("/api/live/now", {
      method: "POST",
      body: JSON.stringify({ channelUuids }),
    });
  }

  liveGuide(opts?: { start?: string; end?: string }) {
    const qs = new URLSearchParams();
    if (opts?.start) qs.set("start", opts.start);
    if (opts?.end) qs.set("end", opts.end);
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request<{ items: EpgProgramme[]; start: string; end: string }>(
      `/api/live/guide${suffix}`,
    );
  }

  toggleLiveFavourite(uuid: string) {
    return this.request<{ favourites: string[]; favourite: boolean }>(
      `/api/live/favourites/${encodeURIComponent(uuid)}/toggle`,
      { method: "POST" },
    );
  }

  playLiveChannel(uuid: string, opts?: { hls?: boolean }) {
    return this.request<{ source: PlaybackSource; title?: string; channel?: LiveChannel }>(
      `/api/live/play/${encodeURIComponent(uuid)}`,
      {
        method: "POST",
        body: JSON.stringify({ hls: Boolean(opts?.hls) }),
      },
    );
  }

  /** Release IPTV/live-HLS when leaving the player (back / close / unmount). */
  stopLivePlayback(uuid?: string) {
    return this.request<{ ok: true }>("/api/live/stop", {
      method: "POST",
      body: JSON.stringify(uuid ? { uuid } : {}),
      keepalive: Boolean((globalThis as { document?: unknown }).document),
    });
  }
}

let defaultClient: ReclinarrClient | null = null;

export function createClient(opts: ReclinarrClientOptions): ReclinarrClient {
  return new ReclinarrClient(opts);
}

export function configureClient(opts: ReclinarrClientOptions): ReclinarrClient {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  // Re-attach with the same origin must keep the in-memory session (Metro reload /
  // LoginScreen ensureClient races used to wipe it between login() and me()).
  if (defaultClient && defaultClient.baseUrl === baseUrl) {
    return defaultClient;
  }
  defaultClient = new ReclinarrClient({ ...opts, baseUrl });
  return defaultClient;
}

export function tryGetClient(): ReclinarrClient | null {
  return defaultClient;
}

export function getClient(): ReclinarrClient {
  if (!defaultClient) {
    throw new Error(
      "No Reclinarr API client configured. Open Change server and set http://<your-mac-lan-ip>:8787",
    );
  }
  return defaultClient;
}

export function login(input: {
  username: string;
  password: string;
  deviceId: string;
  deviceName: string;
}) {
  return getClient().login(input);
}

export function logout() {
  return getClient().logout();
}

export function me() {
  return getClient().me();
}

export function health() {
  return getClient().health();
}

export function healthProviders() {
  return getClient().healthProviders();
}

export function home() {
  return getClient().home();
}

export function mediaByJellyfin(itemId: string) {
  return getClient().mediaByJellyfin(itemId);
}

export function mediaByTmdb(type: "movie" | "tv", tmdbId: number) {
  return getClient().mediaByTmdb(type, tmdbId);
}

export function mediaAvailability(type: "movie" | "tv", tmdbId: number) {
  return getClient().mediaAvailability(type, tmdbId);
}

export function seriesEpisodes(tmdbId: number) {
  return getClient().seriesEpisodes(tmdbId);
}

export function mediaSimilar(type: "movie" | "tv", tmdbId: number) {
  return getClient().mediaSimilar(type, tmdbId);
}

export function myList() {
  return getClient().myList();
}

export function myListHas(type: "movie" | "tv", tmdbId: number) {
  return getClient().myListHas(type, tmdbId);
}

export function toggleMyList(type: "movie" | "tv", tmdbId: number) {
  return getClient().toggleMyList(type, tmdbId);
}

export function discoverTrending(page = 1, mediaType?: "movie" | "tv") {
  return getClient().discoverTrending(page, mediaType);
}

export function discoverMovies(page = 1, opts?: { genreId?: number }) {
  return getClient().discoverMovies(page, opts);
}

export function discoverTv(page = 1, opts?: { genreId?: number }) {
  return getClient().discoverTv(page, opts);
}

export function catalogRails(mediaType: "movie" | "tv", opts?: { search?: string }) {
  return getClient().catalogRails(mediaType, opts);
}

export function searchMedia(q: string, page = 1) {
  return getClient().searchMedia(q, page);
}

export function requestMedia(
  identity: MediaIdentity,
  opts?: { seasons?: number[] | "all"; is4k?: boolean },
) {
  return getClient().requestMedia(identity, opts);
}

export function startAcquisition(
  input: Parameters<ReclinarrClient["startAcquisition"]>[0],
) {
  return getClient().startAcquisition(input);
}

export function getAcquisition(id: string) {
  return getClient().getAcquisition(id);
}

export function cancelAcquisition(id: string) {
  return getClient().cancelAcquisition(id);
}

export function promoteAcquisition(id: string) {
  return getClient().promoteAcquisition(id);
}

export function listAcquisitions() {
  return getClient().listAcquisitions();
}

export function libraryItems(
  mediaType: "movie" | "tv",
  opts?: { startIndex?: number; limit?: number; search?: string },
) {
  return getClient().libraryItems(mediaType, opts);
}

export function listRequests(opts?: Parameters<ReclinarrClient["listRequests"]>[0]) {
  return getClient().listRequests(opts);
}

export function resolvePlayback(
  identity: MediaIdentity,
  opts?: Parameters<ReclinarrClient["resolvePlayback"]>[1],
) {
  return getClient().resolvePlayback(identity, opts);
}

export function measurePlaybackBitrate(itemId?: string) {
  return getClient().measurePlaybackBitrate(itemId);
}

export function resolvePlaybackForPlay(
  identity: MediaIdentity,
  opts?: Parameters<ReclinarrClient["resolvePlaybackForPlay"]>[1],
) {
  return getClient().resolvePlaybackForPlay(identity, opts);
}

export function listPlaybackSubtitles(
  identity: MediaIdentity,
  opts?: Parameters<ReclinarrClient["listPlaybackSubtitles"]>[1],
) {
  return getClient().listPlaybackSubtitles(identity, opts);
}

export function reportProgress(body: Parameters<ReclinarrClient["reportProgress"]>[0]) {
  return getClient().reportProgress(body);
}

export function reportIptvProgress(body: Parameters<ReclinarrClient["reportIptvProgress"]>[0]) {
  return getClient().reportIptvProgress(body);
}

export function liveGroups() {
  return getClient().liveGroups();
}

export function liveChannels(opts?: Parameters<ReclinarrClient["liveChannels"]>[0]) {
  return getClient().liveChannels(opts);
}

export function liveNow(channelUuids: string[]) {
  return getClient().liveNow(channelUuids);
}

export function liveGuide(opts?: Parameters<ReclinarrClient["liveGuide"]>[0]) {
  return getClient().liveGuide(opts);
}

export function toggleLiveFavourite(uuid: string) {
  return getClient().toggleLiveFavourite(uuid);
}

export function playLiveChannel(uuid: string, opts?: { hls?: boolean }) {
  return getClient().playLiveChannel(uuid, opts);
}

export function stopLivePlayback(uuid?: string) {
  return getClient().stopLivePlayback(uuid);
}
