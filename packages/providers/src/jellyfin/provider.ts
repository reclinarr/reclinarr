import type { Media, MediaIdentity, MediaType, PlaybackSource, ProviderHealth } from "@reclinarr/shared";
import { pickAudioTrackIndex, ProviderError } from "@reclinarr/shared";
import { HttpClient, mediaBrowserAuth } from "../http.js";
import type { LibraryProvider, PlaybackProvider, UserContext } from "../types.js";
import { JELLYFIN_CAPABILITIES } from "../types.js";
import { extractTmdbId, hasPlayableMedia, itemMatchesTmdb, ticksToSeconds } from "./identity.js";
import { mapJellyfinItemToMedia } from "./map-item.js";
import {
  BANDWIDTH_PROBE_BYTES,
  DEFAULT_STREAMING_BITRATE,
  bandwidthProbeRangeHeader,
  bitrateFromProbe,
  clampStreamingBitrate,
} from "./bandwidth.js";
import {
  JellyfinAuthResultSchema,
  JellyfinItemSchema,
  JellyfinItemsResponseSchema,
  JellyfinPlaybackInfoSchema,
  JellyfinSystemInfoSchema,
  type JellyfinItem,
} from "./schemas.js";

export interface JellyfinProviderOptions {
  baseUrl: string;
  timeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
  fetchImpl?: typeof fetch;
  /** Public base used when building Reclinarr proxy URLs for playback */
  reclinarrPublicUrl?: string;
}

export class JellyfinProvider implements LibraryProvider, PlaybackProvider {
  readonly id = "jellyfin";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly reclinarrPublicUrl?: string;
  /** Cached upstream probe (Jellyfin hop nginx will use for X-Accel). */
  private bitrateProbe: { bps: number; at: number } | null = null;

  constructor(opts: JellyfinProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.clientName = opts.clientName ?? "Reclinarr";
    this.clientVersion = opts.clientVersion ?? "0.1.0";
    this.fetchImpl = opts.fetchImpl;
    this.reclinarrPublicUrl = opts.reclinarrPublicUrl;
  }

  capabilities() {
    return JELLYFIN_CAPABILITIES;
  }

  private httpFor(ctx?: UserContext, deviceId = "reclinarr-health"): HttpClient {
    const token = ctx?.jellyfinAccessToken;
    return new HttpClient({
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      serviceName: "jellyfin",
      fetchImpl: this.fetchImpl,
      defaultHeaders: {
        Authorization: mediaBrowserAuth({
          client: this.clientName,
          device: ctx?.deviceName ?? "Reclinarr",
          deviceId: ctx?.deviceId ?? deviceId,
          version: this.clientVersion,
          token,
        }),
      },
    });
  }

  async authenticate(input: {
    username: string;
    password: string;
    deviceId: string;
    deviceName: string;
  }) {
    const http = new HttpClient({
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      serviceName: "jellyfin",
      fetchImpl: this.fetchImpl,
      defaultHeaders: {
        Authorization: mediaBrowserAuth({
          client: this.clientName,
          device: input.deviceName,
          deviceId: input.deviceId,
          version: this.clientVersion,
        }),
      },
    });

    const { data } = await http.request("POST", "/Users/AuthenticateByName", {
      body: { Username: input.username, Pw: input.password },
      schema: JellyfinAuthResultSchema,
    });

    return {
      userId: data.User.Id,
      username: data.User.Name,
      accessToken: data.AccessToken,
      serverId: data.ServerId,
    };
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const { data } = await this.httpFor().request("GET", "/System/Info/Public", {
        schema: JellyfinSystemInfoSchema,
        allowStatuses: [200],
      });
      return {
        id: this.id,
        status: "ok",
        latencyMs: Date.now() - started,
        message: data.ServerName ? `Jellyfin ${data.Version ?? ""}`.trim() : undefined,
        capabilities: this.capabilities(),
      };
    } catch (err) {
      // Public info may require auth on some installs — try System/Info without token as degraded probe
      try {
        await this.httpFor().request("GET", "/System/Info", {
          schema: JellyfinSystemInfoSchema,
        });
        return {
          id: this.id,
          status: "ok",
          latencyMs: Date.now() - started,
          capabilities: this.capabilities(),
        };
      } catch {
        return {
          id: this.id,
          status: "down",
          latencyMs: Date.now() - started,
          message: err instanceof Error ? err.message : String(err),
          capabilities: this.capabilities(),
        };
      }
    }
  }

  async getContinueWatching(userContext: UserContext): Promise<Media[]> {
    const { data } = await this.httpFor(userContext).request("GET", "/UserItems/Resume", {
      query: {
        userId: userContext.jellyfinUserId,
        Limit: 24,
        // Seasons / folders leak in without this and become "Season 1" / other cards.
        IncludeItemTypes: "Movie,Episode",
        Fields: "ProviderIds,Path,MediaSources,Overview,UserData",
      },
      schema: JellyfinItemsResponseSchema,
    });
    return (data.Items ?? [])
      .map((item) => this.toMedia(item))
      .filter((m) => m.identity.mediaType === "movie" || m.identity.mediaType === "episode");
  }

  async getNextUp(userContext: UserContext): Promise<Media[]> {
    const { data } = await this.httpFor(userContext).request("GET", "/Shows/NextUp", {
      query: {
        userId: userContext.jellyfinUserId,
        Limit: 24,
        Fields: "ProviderIds,Path,MediaSources,Overview,UserData",
      },
      schema: JellyfinItemsResponseSchema,
    });
    return (data.Items ?? []).map((item) => this.toMedia(item));
  }

  async getRecentlyAdded(userContext: UserContext): Promise<Media[]> {
    const { data } = await this.httpFor(userContext).request<unknown>("GET", "/Items/Latest", {
      query: {
        userId: userContext.jellyfinUserId,
        Limit: 24,
        Fields: "ProviderIds,Path,MediaSources,Overview,UserData",
      },
    });
    const items = parseLatestItems(data);
    return items.map((item) => this.toMedia(item));
  }

  async getByJellyfinItemId(userContext: UserContext, itemId: string): Promise<Media | null> {
    try {
      const { data } = await this.httpFor(userContext).request(
        "GET",
        `/Items/${encodeURIComponent(itemId)}`,
        {
          query: {
            userId: userContext.jellyfinUserId,
            Fields: "ProviderIds,Path,MediaSources,Overview,UserData",
          },
          schema: JellyfinItemSchema,
        },
      );
      // Season folders are not playable details pages — open the parent series
      // (Continue Watching historically leaked Season items as "Season 1").
      if (data.Type === "Season" && data.SeriesId && data.SeriesId !== itemId) {
        return this.getByJellyfinItemId(userContext, data.SeriesId);
      }
      return this.toMedia(data);
    } catch (err) {
      if (err instanceof ProviderError && err.code === "not_found") return null;
      throw err;
    }
  }

  async findByTmdb(
    userContext: UserContext,
    tmdbId: number,
    mediaType: MediaType,
  ): Promise<Media | null> {
    const include =
      mediaType === "movie" ? "Movie" : mediaType === "tv" ? "Series" : "Movie,Series,Episode";
    const { data } = await this.httpFor(userContext).request("GET", "/Items", {
      query: {
        Recursive: true,
        userId: userContext.jellyfinUserId,
        AnyProviderIdEquals: `Tmdb.${tmdbId}`,
        IncludeItemTypes: include,
        Fields: "ProviderIds,Path,MediaSources,Overview,UserData",
      },
      schema: JellyfinItemsResponseSchema,
    });

    const matched = (data.Items ?? []).filter(
      (item) => itemMatchesTmdb(item, tmdbId) && hasPlayableMedia(item),
    );
    const item = matched[0];
    if (!item) {
      void extractTmdbId;
      return null;
    }
    return this.toMedia(item);
  }

  async listLibrary(
    userContext: UserContext,
    opts: {
      mediaType: "movie" | "tv";
      startIndex?: number;
      limit?: number;
      search?: string;
      sortBy?: string;
    },
  ): Promise<{ items: Media[]; total: number }> {
    const include = opts.mediaType === "movie" ? "Movie" : "Series";
    const { data } = await this.httpFor(userContext).request("GET", "/Items", {
      query: {
        Recursive: true,
        userId: userContext.jellyfinUserId,
        IncludeItemTypes: include,
        StartIndex: opts.startIndex ?? 0,
        Limit: opts.limit ?? 48,
        SortBy: opts.sortBy ?? "SortName",
        SortOrder: "Ascending",
        SearchTerm: opts.search?.trim() || undefined,
        Fields: "ProviderIds,Path,MediaSources,Overview,UserData",
      },
      schema: JellyfinItemsResponseSchema,
    });
    return {
      items: (data.Items ?? []).map((item) => this.toMedia(item)),
      total: data.TotalRecordCount ?? data.Items?.length ?? 0,
    };
  }

  async listEpisodesForSeries(userContext: UserContext, seriesItemId: string): Promise<Media[]> {
    if (!seriesItemId) return [];
    const { data } = await this.httpFor(userContext).request(
      "GET",
      `/Shows/${encodeURIComponent(seriesItemId)}/Episodes`,
      {
        query: {
          userId: userContext.jellyfinUserId,
          Fields: "ProviderIds,Path,MediaSources,Overview,UserData",
        },
        schema: JellyfinItemsResponseSchema,
      },
    );
    return (data.Items ?? []).map((item) => {
      const media = this.toMedia(item);
      // Prefer raw episode name in season lists (mapJellyfinItem uses Series SxEx).
      const name = item.Name?.trim();
      if (name) {
        return { ...media, metadata: { ...media.metadata, title: name } };
      }
      return media;
    });
  }

  private toMedia(item: JellyfinItem): Media {
    return mapJellyfinItemToMedia(item, {
      jellyfinBaseUrl: this.baseUrl,
      imageProxyBase: this.reclinarrPublicUrl,
    });
  }

  async openImage(
    userContext: UserContext,
    itemId: string,
    imageType: string,
    resize?: { maxWidth?: number; maxHeight?: number; quality?: number },
  ): Promise<Response> {
    const params = new URLSearchParams();
    if (resize?.maxWidth) params.set("maxWidth", String(resize.maxWidth));
    if (resize?.maxHeight) params.set("maxHeight", String(resize.maxHeight));
    if (resize?.quality) params.set("quality", String(resize.quality));
    const query = params.toString();
    const url = `${this.baseUrl}/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(imageType)}${query ? `?${query}` : ""}`;
    const res = await (this.fetchImpl ?? fetch)(url, {
      headers: {
        Authorization: mediaBrowserAuth({
          client: this.clientName,
          device: userContext.deviceName,
          deviceId: userContext.deviceId,
          version: this.clientVersion,
          token: userContext.jellyfinAccessToken,
        }),
      },
    });
    if (!res.ok) {
      throw new ProviderError(`Jellyfin image failed: ${res.status}`, {
        code: classifyOrUnknown(res.status),
        provider: "jellyfin",
        statusCode: res.status,
      });
    }
    return res;
  }

  async resolvePlayback(
    userContext: UserContext,
    identity: MediaIdentity,
    opts?: {
      startPositionSeconds?: number;
      audioStreamIndex?: number;
      /** Select this language when the file has a matching audio stream. */
      preferredAudioLanguage?: string;
      /** Client-measured cap (bits/s); combined with a server probe of the Jellyfin hop. */
      maxStreamingBitrate?: number;
      deviceProfile?: "web" | "ios" | "android";
    },
  ): Promise<PlaybackSource | null> {
    const itemId = identity.jellyfinItemId;
    if (!itemId) return null;
    const deviceProfile = opts?.deviceProfile ?? "web";
    const native = deviceProfile === "ios" || deviceProfile === "android";

    const item = await this.getByJellyfinItemId(userContext, itemId);
    const jellyfinAvail = item?.availability.find((a) => a.provider === "jellyfin");
    const savedPosition = jellyfinAvail?.positionSeconds ?? 0;
    const durationSeconds =
      jellyfinAvail?.durationSeconds ?? item?.metadata?.durationSeconds;
    // Explicit seek/resume wins; otherwise Continue Watching.
    // Resume offset for the client (hls.js startPosition). Do NOT send
    // StartTimeTicks to Jellyfin: it still returns a full VOD playlist from t=0,
    // and combining StartTimeTicks + client seek makes scrub snap back to
    // Continue Watching / playlist head.
    const startPositionSeconds =
      opts?.startPositionSeconds != null && opts.startPositionSeconds > 0
        ? opts.startPositionSeconds
        : savedPosition;

    const probed = await this.probeUpstreamBitrate(userContext, itemId);
    const maxStreamingBitrate = clampStreamingBitrate(
      opts?.maxStreamingBitrate != null
        ? Math.min(opts.maxStreamingBitrate, probed)
        : probed,
    );

    const requestInfo = (audioStreamIndex?: number) =>
      this.httpFor(userContext).request(
        "POST",
        `/Items/${encodeURIComponent(itemId)}/PlaybackInfo`,
        {
          query: { userId: userContext.jellyfinUserId },
          body: {
            UserId: userContext.jellyfinUserId,
            DeviceProfile: native
              ? nativeDeviceProfile(deviceProfile, maxStreamingBitrate)
              : browserDeviceProfile(maxStreamingBitrate),
            EnableDirectPlay: true,
            EnableDirectStream: true,
            EnableTranscoding: true,
            MaxStreamingBitrate: maxStreamingBitrate,
            ...(audioStreamIndex != null ? { AudioStreamIndex: audioStreamIndex } : {}),
          },
          schema: JellyfinPlaybackInfoSchema,
        },
      );

    let audioStreamIndex = opts?.audioStreamIndex;
    let { data } = await requestInfo(audioStreamIndex);
    let source = data.MediaSources?.[0];
    if (!source) return null;

    if (audioStreamIndex == null && opts?.preferredAudioLanguage) {
      const tracks = [];
      for (const stream of source.MediaStreams ?? []) {
        if (stream.Type === "Audio" && stream.Index != null) {
          tracks.push({ index: stream.Index, language: stream.Language });
        }
      }
      const picked = pickAudioTrackIndex(tracks, opts.preferredAudioLanguage);
      const defaultAudio = source.DefaultAudioStreamIndex ?? undefined;
      if (picked != null && picked !== defaultAudio) {
        audioStreamIndex = picked;
        const again = await requestInfo(audioStreamIndex);
        data = again.data;
        source = data.MediaSources?.[0] ?? source;
      }
    }

    const playSessionId = data.PlaySessionId;
    let playMethod = native
      ? resolvePlayMethodForNative(source)
      : resolvePlayMethodForBrowser(source);
    const requestedAudio = audioStreamIndex;
    const defaultAudio = source.DefaultAudioStreamIndex ?? undefined;
    // DirectPlay streams the full file; browsers pick their own default audio and
    // ignore AudioStreamIndex on static URLs. Force remux/transcode when the user
    // selects a non-default track so Jellyfin emits only that stream.
    if (
      requestedAudio != null &&
      playMethod === "DirectPlay" &&
      (defaultAudio == null || requestedAudio !== defaultAudio)
    ) {
      if (native && source.SupportsDirectStream) {
        playMethod = "DirectStream";
      } else {
        const hlsAvailable =
          source.TranscodingSubProtocol === "hls" ||
          Boolean(source.TranscodingUrl?.includes(".m3u8"));
        if (!native && hlsAvailable) playMethod = "Transcode";
        else if (source.SupportsDirectStream || source.SupportsTranscoding) {
          playMethod = source.SupportsDirectStream ? "DirectStream" : "Transcode";
        }
      }
    }
    const isHls =
      playMethod === "Transcode" &&
      (source.TranscodingSubProtocol === "hls" ||
        Boolean(source.TranscodingUrl?.includes(".m3u8")));

    const params = new URLSearchParams({
      mediaSourceId: source.Id,
      playMethod,
    });
    if (playSessionId) params.set("playSessionId", playSessionId);
    const audioIndex = requestedAudio ?? source.DefaultAudioStreamIndex;
    if (audioIndex != null) {
      params.set("audioStreamIndex", String(audioIndex));
    }
    if (source.TranscodingUrl && playMethod === "Transcode") {
      const relative = normalizeJellyfinRelativePath(source.TranscodingUrl, this.baseUrl);
      // Strip any StartTimeTicks Jellyfin echoed — full VOD playlist + client seek only.
      if (relative) {
        try {
          const u = new URL(relative, "http://jellyfin.local");
          u.searchParams.delete("StartTimeTicks");
          if (audioIndex != null) {
            u.searchParams.set("AudioStreamIndex", String(audioIndex));
          }
          // Native progressive Transcode must not burn default ASS — we sideload text.
          if (native && !isHls) {
            u.searchParams.delete("SubtitleStreamIndex");
            u.searchParams.delete("SubtitleMethod");
          }
          params.set("transcodingPath", `${u.pathname}${u.search}`);
        } catch {
          params.set("transcodingPath", relative);
        }
      }
    }

    // Same-origin Reclinarr proxy keeps Jellyfin tokens server-side (session cookie only).
    // Browser never sees Jellyfin credentials; DirectPlay/DirectStream/Transcode still run on Jellyfin.
    const proxyUrl = `/api/playback/jellyfin/stream/${encodeURIComponent(itemId)}?${params.toString()}`;

    const audioTracks = (source.MediaStreams ?? [])
      .filter((s) => s.Type === "Audio")
      .map((s) => ({
        index: s.Index ?? 0,
        language: s.Language ?? undefined,
        label: s.DisplayTitle ?? s.Codec ?? undefined,
      }));

    const subtitles = (source.MediaStreams ?? [])
      .filter((s) => s.Type === "Subtitle" && isBrowserTextSubtitle(s))
      .map((s) => {
        const index = s.Index ?? 0;
        return {
          index,
          language: s.Language ?? undefined,
          label: subtitleLabelFromStream(s, index),
          forced: Boolean(s.IsForced),
          hearingImpaired: Boolean(s.IsHearingImpaired),
          url: `/api/playback/jellyfin/subtitle/${encodeURIComponent(itemId)}/${index}?mediaSourceId=${encodeURIComponent(source.Id)}`,
        };
      });

    return {
      provider: "jellyfin",
      delivery: { mode: "proxy", url: proxyUrl },
      directPlay: playMethod === "DirectPlay",
      playMethod,
      hls: isHls,
      mimeType: isHls
        ? "application/vnd.apple.mpegurl"
        : playMethod === "DirectStream" || (playMethod === "Transcode" && !isHls)
          ? "video/mp4"
          : source.Container
            ? `video/${source.Container}`
            : undefined,
      playSessionId,
      mediaSourceId: source.Id,
      itemId,
      startPositionSeconds,
      ...(durationSeconds != null && durationSeconds > 0 ? { durationSeconds } : {}),
      audioTracks,
      subtitles,
    };
  }

  async reportProgress(
    userContext: UserContext,
    input: {
      itemId: string;
      positionSeconds: number;
      isPaused?: boolean;
      playSessionId?: string;
      mediaSourceId?: string;
      playMethod?: "DirectPlay" | "DirectStream" | "Transcode";
      event: "start" | "progress" | "stopped";
    },
  ): Promise<void> {
    const path =
      input.event === "start"
        ? "/Sessions/Playing"
        : input.event === "stopped"
          ? "/Sessions/Playing/Stopped"
          : "/Sessions/Playing/Progress";

    // Jellyfin 10.x expects a fuller playback session payload; a bare Progress
    // body often 500s ("Error processing request") and must not break the client.
    const positionTicks = Math.round(Math.max(0, input.positionSeconds) * 10_000_000);
    const body = {
      ItemId: input.itemId,
      PositionTicks: positionTicks,
      IsPaused: input.isPaused ?? false,
      CanSeek: true,
      IsMuted: false,
      PlayMethod: input.playMethod ?? "Transcode",
      RepeatMode: "RepeatNone",
      PlaybackRate: 1,
      VolumeLevel: 100,
      ...(input.playSessionId ? { PlaySessionId: input.playSessionId } : {}),
      ...(input.mediaSourceId ? { MediaSourceId: input.mediaSourceId } : {}),
    };

    try {
      await this.httpFor(userContext).request("POST", path, {
        body,
        allowStatuses: [200, 204],
      });
      return;
    } catch {
      // Sessions/Playing* often 500s when there is no live session (reload,
      // DirectPlay/Transcode mismatch, or cache/IPTV wrongly routed here).
      // Prefer UserData so Continue Watching still advances; never throw for
      // progress/stopped — the player soft-acks either way.
    }

    if (input.event === "start") {
      // Start is best-effort; Progress will land via UserData.
      return;
    }

    try {
      await this.httpFor(userContext).request(
        "POST",
        `/Users/${encodeURIComponent(userContext.jellyfinUserId)}/Items/${encodeURIComponent(input.itemId)}/UserData`,
        {
          body: {
            PlaybackPositionTicks: positionTicks,
            Played: false,
          },
          allowStatuses: [200, 204],
        },
      );
    } catch {
      /* ignore — Continue Watching may lag until the next successful write */
    }
  }

  /** Trigger a full library scan (admin/user depending on Jellyfin permissions). */
  async refreshLibrary(userContext: UserContext): Promise<void> {
    await this.httpFor(userContext).request("POST", "/Library/Refresh", {
      allowStatuses: [200, 204],
    });
  }

  /**
   * Notify Jellyfin that files appeared under known library paths so a targeted
   * scan can pick them up without waiting for a full refresh.
   */
  async notifyLibraryPathsUpdated(
    userContext: UserContext,
    paths: string[],
  ): Promise<void> {
    const unique = [...new Set(paths.filter(Boolean))];
    if (unique.length === 0) return;
    await this.httpFor(userContext).request("POST", "/Library/Media/Updated", {
      body: {
        Updates: unique.map((Path) => ({
          Path,
          UpdateType: "Created",
        })),
      },
      allowStatuses: [200, 204],
    });
  }

  /**
   * URL + headers for a Range-able Jellyfin download used by bandwidth probes.
   * Prefer the title being played; otherwise the first library movie/episode.
   */
  async resolveBandwidthProbeTarget(
    userContext: UserContext,
    itemId?: string,
  ): Promise<{ url: URL; headers: Record<string, string> }> {
    let probeItemId = itemId;
    if (!probeItemId) {
      const { data } = await this.httpFor(userContext).request(
        "GET",
        `/Users/${encodeURIComponent(userContext.jellyfinUserId)}/Items`,
        {
          query: {
            Recursive: true,
            IncludeItemTypes: "Movie,Episode",
            Limit: 1,
            Fields: "Path",
          },
          schema: JellyfinItemsResponseSchema,
        },
      );
      probeItemId = data.Items?.[0]?.Id;
    }
    if (!probeItemId) {
      throw new ProviderError("No Jellyfin item available for bandwidth probe", {
        code: "unavailable",
        provider: "jellyfin",
      });
    }

    // Use the same /Videos/.../stream media hop as HLS (api_key in query).
    // /Items/.../Download is often blocked or auth-different behind Cloudflare.
    const url = new URL(
      `${this.baseUrl}/Videos/${encodeURIComponent(probeItemId)}/stream`,
    );
    url.searchParams.set("static", "true");
    url.searchParams.set("api_key", userContext.jellyfinAccessToken);
    const headers: Record<string, string> = {
      Authorization: mediaBrowserAuth({
        client: this.clientName,
        device: userContext.deviceName,
        deviceId: userContext.deviceId,
        version: this.clientVersion,
        token: userContext.jellyfinAccessToken,
      }),
      Range: bandwidthProbeRangeHeader(),
    };
    return { url, headers };
  }

  /**
   * Time a ~1.5 MiB Range download from Jellyfin (same hop nginx uses for media).
   * Cached briefly so scrubbing / subtitle resolves do not re-probe every time.
   */
  async probeUpstreamBitrate(
    userContext: UserContext,
    itemId?: string,
  ): Promise<number> {
    const now = Date.now();
    if (this.bitrateProbe && now - this.bitrateProbe.at < 60_000) {
      return this.bitrateProbe.bps;
    }

    try {
      const { url, headers } = await this.resolveBandwidthProbeTarget(
        userContext,
        itemId,
      );
      const fetchImpl = this.fetchImpl ?? fetch;
      const t0 = Date.now();
      const res = await fetchImpl(url, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 10_000)),
      });
      if (!res.ok && res.status !== 206) {
        throw new ProviderError(`Bandwidth probe failed: ${res.status}`, {
          code: classifyOrUnknown(res.status),
          provider: "jellyfin",
          statusCode: res.status,
        });
      }
      const reader = res.body?.getReader();
      if (!reader) {
        const buf = await res.arrayBuffer();
        const bps = bitrateFromProbe(buf.byteLength, (Date.now() - t0) / 1000);
        this.bitrateProbe = { bps, at: Date.now() };
        return bps;
      }
      let got = 0;
      while (got < BANDWIDTH_PROBE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.byteLength;
      }
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      const bps = bitrateFromProbe(got, (Date.now() - t0) / 1000);
      this.bitrateProbe = { bps, at: Date.now() };
      return bps;
    } catch (err) {
      console.warn(
        "[jellyfin] bandwidth probe failed, using default",
        err instanceof Error ? err.message : err,
      );
      return DEFAULT_STREAMING_BITRATE;
    }
  }

  /**
   * Build the Jellyfin media URL + auth headers without opening the body.
   * Used by nginx X-Accel-Redirect (token stays server-side in the accel path).
   */
  resolveStreamTarget(
    userContext: UserContext,
    itemId: string,
    opts: {
      mediaSourceId: string;
      playMethod?: "DirectPlay" | "DirectStream" | "Transcode";
      playSessionId?: string;
      audioStreamIndex?: number;
      transcodingPath?: string;
      jellyfinPath?: string;
    },
  ): { url: URL; headers: Record<string, string> } {
    let url: URL;

    if (opts.jellyfinPath) {
      url = this.resolveJellyfinMediaUrl(opts.jellyfinPath, { allowApiPaths: false });
    } else if (opts.playMethod === "Transcode" && opts.transcodingPath) {
      url = this.resolveJellyfinMediaUrl(opts.transcodingPath, { allowApiPaths: false });
    } else if (opts.playMethod === "DirectStream" || opts.playMethod === "Transcode") {
      // Remux / audio-transcode to AAC when DirectPlay is unsafe for browsers.
      url = new URL(`${this.baseUrl}/Videos/${encodeURIComponent(itemId)}/stream.mp4`);
      url.searchParams.set("mediaSourceId", opts.mediaSourceId);
      url.searchParams.set("VideoCodec", "h264");
      url.searchParams.set("AudioCodec", "aac");
      url.searchParams.set("AudioBitrate", "384000");
      url.searchParams.set("MaxAudioChannels", "2");
      url.searchParams.set("TranscodingContainer", "mp4");
      url.searchParams.set("TranscodingProtocol", "http");
      if (opts.playSessionId) url.searchParams.set("PlaySessionId", opts.playSessionId);
      if (opts.audioStreamIndex != null) {
        url.searchParams.set("AudioStreamIndex", String(opts.audioStreamIndex));
      }
    } else {
      url = new URL(`${this.baseUrl}/Videos/${encodeURIComponent(itemId)}/stream`);
      url.searchParams.set("static", "true");
      url.searchParams.set("mediaSourceId", opts.mediaSourceId);
      if (opts.playSessionId) url.searchParams.set("PlaySessionId", opts.playSessionId);
      if (opts.audioStreamIndex != null) {
        url.searchParams.set("AudioStreamIndex", String(opts.audioStreamIndex));
      }
    }

    // Prefer Authorization header; api_key helps some Jellyfin media paths.
    // Only attach after the URL is confirmed to be same-origin with this.baseUrl.
    if (!url.searchParams.has("api_key")) {
      url.searchParams.set("api_key", userContext.jellyfinAccessToken);
    }

    const headers: Record<string, string> = {
      Authorization: mediaBrowserAuth({
        client: this.clientName,
        device: userContext.deviceName,
        deviceId: userContext.deviceId,
        version: this.clientVersion,
        token: userContext.jellyfinAccessToken,
      }),
    };
    return { url, headers };
  }

  /** Proxy helper used by the API stream route (node media plane). */
  async openStream(
    userContext: UserContext,
    itemId: string,
    opts: {
      mediaSourceId: string;
      playMethod?: "DirectPlay" | "DirectStream" | "Transcode";
      playSessionId?: string;
      audioStreamIndex?: number;
      transcodingPath?: string;
      /** Extra path/query from HLS segment requests */
      jellyfinPath?: string;
      /** Forward Range for seeking */
      range?: string;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const { url, headers } = this.resolveStreamTarget(userContext, itemId, opts);
    if (opts.range) headers.Range = opts.range;

    const res = await (this.fetchImpl ?? fetch)(url, {
      headers,
      signal: opts.signal,
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      throw new ProviderError("Jellyfin stream redirected off expected origin", {
        code: "unavailable",
        provider: "jellyfin",
        statusCode: res.status,
      });
    }
    if (!res.ok && res.status !== 206) {
      throw new ProviderError(`Jellyfin stream failed: ${res.status}`, {
        code: classifyOrUnknown(res.status),
        provider: "jellyfin",
        statusCode: res.status,
      });
    }
    return res;
  }

  /**
   * Resolve a client-supplied Jellyfin media path to this server's base URL.
   * Rejects absolute off-host URLs, userinfo, and path traversal.
   */
  resolveJellyfinMediaUrl(
    rawPath: string,
    opts?: { allowApiPaths?: boolean },
  ): URL {
    const path = normalizeJellyfinRelativePath(rawPath, this.baseUrl);
    if (!path) {
      throw new ProviderError("Invalid Jellyfin media path", {
        code: "unavailable",
        provider: "jellyfin",
        statusCode: 400,
      });
    }
    if (!opts?.allowApiPaths && !isJellyfinMediaPath(path)) {
      throw new ProviderError("Jellyfin path is not a media stream path", {
        code: "unavailable",
        provider: "jellyfin",
        statusCode: 400,
      });
    }
    return new URL(`${this.baseUrl}${path}`);
  }

  /** Text subtitle (SRT/VTT/ASS) as WebVTT. Bitmap subs such as PGS are not supported. */
  async openSubtitle(
    userContext: UserContext,
    itemId: string,
    mediaSourceId: string,
    index: number,
  ): Promise<Response> {
    const url = new URL(
      `${this.baseUrl}/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(mediaSourceId)}/Subtitles/${index}/Stream.vtt`,
    );
    url.searchParams.set("api_key", userContext.jellyfinAccessToken);
    const res = await (this.fetchImpl ?? fetch)(url, {
      headers: {
        Authorization: mediaBrowserAuth({
          client: this.clientName,
          device: userContext.deviceName,
          deviceId: userContext.deviceId,
          version: this.clientVersion,
          token: userContext.jellyfinAccessToken,
        }),
      },
    });
    if (!res.ok) {
      throw new ProviderError(`Jellyfin subtitle failed: ${res.status}`, {
        code: classifyOrUnknown(res.status),
        provider: "jellyfin",
        statusCode: res.status,
      });
    }
    return res;
  }
}

function classifyOrUnknown(status: number) {
  if (status === 401 || status === 403) return "unauthorized" as const;
  if (status === 404) return "not_found" as const;
  return "unavailable" as const;
}

function parseLatestItems(data: unknown): JellyfinItem[] {
  if (Array.isArray(data)) {
    return data
      .map((item) => JellyfinItemSchema.safeParse(item))
      .filter((r) => r.success)
      .map((r) => r.data);
  }
  const parsed = JellyfinItemsResponseSchema.safeParse(data);
  return parsed.success ? (parsed.data.Items ?? []) : [];
}

function resolvePlayMethod(source: {
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  TranscodingUrl?: string | null;
}): "DirectPlay" | "DirectStream" | "Transcode" {
  if (source.SupportsDirectPlay) return "DirectPlay";
  if (source.TranscodingUrl || source.SupportsTranscoding) {
    // Prefer HLS/transcode when Jellyfin rejected DirectPlay (usually incompatible audio).
    if (source.TranscodingUrl) return "Transcode";
  }
  if (source.SupportsDirectStream) return "DirectStream";
  if (source.SupportsTranscoding) return "Transcode";
  // Never fall back to blind DirectPlay — Chrome will show video with silent AC3/DTS.
  return "DirectStream";
}

const UNSAFE_BROWSER_AUDIO = new Set([
  "ac3",
  "eac3",
  "e-ac-3",
  "dca",
  "dts",
  "dtshd",
  "truehd",
  "mlp",
  "pcm",
  "flac",
]);

function defaultAudioCodec(source: {
  DefaultAudioStreamIndex?: number | null;
  MediaStreams?: Array<{
    Type?: string;
    Codec?: string | null;
    Index?: number;
    IsDefault?: boolean;
  }> | null;
}): string | undefined {
  const streams = source.MediaStreams ?? [];
  const audio = streams.filter((s) => s.Type === "Audio");
  if (!audio.length) return undefined;
  const byIndex =
    source.DefaultAudioStreamIndex != null
      ? audio.find((s) => s.Index === source.DefaultAudioStreamIndex)
      : undefined;
  const chosen = byIndex ?? audio.find((s) => s.IsDefault) ?? audio[0];
  return chosen?.Codec ?? undefined;
}

function isBrowserSafeAudio(codec: string | undefined): boolean {
  if (!codec) return false;
  const c = codec.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (UNSAFE_BROWSER_AUDIO.has(c) || UNSAFE_BROWSER_AUDIO.has(codec.toLowerCase())) {
    return false;
  }
  return c === "aac" || c === "mp3" || c === "opus" || c === "vorbis" || c === "mp4a" || c.startsWith("aac");
}

const TEXT_SUB_CODECS = new Set([
  "srt",
  "subrip",
  "vtt",
  "webvtt",
  "ass",
  "ssa",
  "ttml",
  "mov_text",
  "tx3g",
  "text",
]);

const BITMAP_SUB_CODECS = new Set([
  "pgssub",
  "pgs",
  "hdmv_pgs_subtitle",
  "dvdsub",
  "dvd_subtitle",
  "vobsub",
  "dvbsub",
  "dvb_subtitle",
]);

function isBrowserTextSubtitle(stream: {
  Codec?: string | null;
  IsTextSubtitleStream?: boolean;
  IsExternal?: boolean;
}): boolean {
  const codec = (stream.Codec ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (BITMAP_SUB_CODECS.has(codec)) return false;
  if (stream.IsTextSubtitleStream) return true;
  if (TEXT_SUB_CODECS.has(codec)) return true;
  // Bazarr writes external text sidecars. Jellyfin marks those external.
  return Boolean(stream.IsExternal);
}

function subtitleLabelFromStream(
  stream: {
    DisplayTitle?: string | null;
    Language?: string | null;
    IsForced?: boolean;
    IsHearingImpaired?: boolean;
  },
  index: number,
): string {
  const base = stream.DisplayTitle ?? stream.Language ?? `Subtitle ${index}`;
  const extras: string[] = [];
  if (stream.IsHearingImpaired && !/sdh|hearing/i.test(base)) extras.push("SDH");
  if (stream.IsForced && !/forced/i.test(base)) extras.push("Forced");
  return extras.length ? `${base} · ${extras.join(" · ")}` : base;
}

type JellyfinMediaSourceHint = {
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  TranscodingUrl?: string | null;
  TranscodingSubProtocol?: string | null;
  Container?: string | null;
  DefaultAudioStreamIndex?: number | null;
  MediaStreams?: Array<{
    Type?: string;
    Codec?: string | null;
    Index?: number;
    IsDefault?: boolean;
  }> | null;
};

/**
 * Prefer Jellyfin's suggestion, but never DirectPlay unsafe audio codecs.
 * DirectStream / Transcode paths force AAC in openStream().
 */
function resolvePlayMethodForBrowser(
  source: JellyfinMediaSourceHint,
): "DirectPlay" | "DirectStream" | "Transcode" {
  const method = resolvePlayMethod(source);
  if (method !== "DirectPlay") return method;
  if (isBrowserSafeAudio(defaultAudioCodec(source))) return "DirectPlay";
  if (source.TranscodingUrl) return "Transcode";
  if (source.SupportsDirectStream) return "DirectStream";
  if (source.SupportsTranscoding) return "Transcode";
  return "DirectStream";
}

/**
 * Native players: DirectPlay only for AVPlayer/ExoPlayer-safe progressive files.
 * Prefer Jellyfin HLS over DirectStream — progressive stream.mp4 remux often
 * stalls with 0 bytes, while HLS starts reliably. Session auth is embedded in
 * playlist/segment query strings for AVPlayer.
 */
function resolvePlayMethodForNative(
  source: JellyfinMediaSourceHint,
): "DirectPlay" | "DirectStream" | "Transcode" {
  const method = resolvePlayMethod(source);
  const container = (source.Container ?? "").toLowerCase();
  const unsafeContainer =
    container.includes("mkv") ||
    container.includes("matroska") ||
    container.includes("mpegts") ||
    container === "ts" ||
    container.includes("m2ts");
  if (
    method === "DirectPlay" &&
    !unsafeContainer &&
    isNativeSafeAudio(defaultAudioCodec(source))
  ) {
    return "DirectPlay";
  }
  const hls =
    source.TranscodingSubProtocol === "hls" ||
    Boolean(source.TranscodingUrl?.includes(".m3u8"));
  if (hls || source.TranscodingUrl) return "Transcode";
  if (source.SupportsTranscoding) return "Transcode";
  if (source.SupportsDirectStream || method === "DirectStream") {
    return "DirectStream";
  }
  return "DirectStream";
}

function isNativeSafeAudio(codec: string | undefined): boolean {
  if (!codec) return true;
  const c = codec.toLowerCase();
  // iOS/Android handle these in DirectPlay containers; DTS/TrueHD still need remux.
  return ["aac", "mp3", "ac3", "eac3", "flac", "alac", "opus"].includes(c);
}

/** iOS/Android profile — DirectPlay only containers the OS player can open. */
function nativeDeviceProfile(
  kind: "ios" | "android",
  maxStreamingBitrate: number,
) {
  const videoAudio = "aac,mp3,ac3,eac3,flac,alac,opus";
  const videoCodecs = "h264,hevc,mpeg4,vp9";
  const maxBitrate = clampStreamingBitrate(maxStreamingBitrate);
  const directPlayContainers = [
    {
      Container: "mp4,m4v,mov",
      Type: "Video",
      VideoCodec: videoCodecs,
      AudioCodec: videoAudio,
    },
    {
      Container: "hls",
      Type: "Video",
      VideoCodec: "h264,hevc",
      AudioCodec: "aac,ac3,eac3",
    },
  ];
  return {
    Name: kind === "ios" ? "Reclinarr iOS" : "Reclinarr Android",
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: maxBitrate,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: [
      ...directPlayContainers,
      { Container: "mp3", Type: "Audio", AudioCodec: "mp3" },
      { Container: "mp4,m4a,aac", Type: "Audio", AudioCodec: "aac" },
    ],
    TranscodingProfiles: [
      // HLS first — progressive http remux (stream.mp4) frequently stalls.
      {
        Container: "ts",
        Type: "Video",
        VideoCodec: "h264",
        AudioCodec: "aac",
        Protocol: "hls",
        Context: "Streaming",
        MaxAudioChannels: "2",
        MinSegments: 2,
        BreakOnNonKeyFrames: false,
      },
      {
        Container: "mp4",
        Type: "Video",
        VideoCodec: "h264",
        AudioCodec: "aac",
        Protocol: "http",
        Context: "Streaming",
        MaxAudioChannels: "2",
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      {
        Type: "Video",
        Codec: "hevc",
        Conditions: [
          {
            Condition: "EqualsAny",
            Property: "VideoProfile",
            Value: "main|main 10",
            IsRequired: false,
          },
          {
            Condition: "LessThanEqual",
            Property: "VideoBitDepth",
            Value: "10",
            IsRequired: false,
          },
          {
            Condition: "LessThanEqual",
            Property: "Width",
            Value: "3840",
            IsRequired: false,
          },
          {
            Condition: "LessThanEqual",
            Property: "Height",
            Value: "2160",
            IsRequired: false,
          },
        ],
      },
      {
        Type: "Video",
        Codec: "h264",
        Conditions: [
          {
            Condition: "EqualsAny",
            Property: "VideoProfile",
            Value: "high|main|baseline|constrained baseline",
            IsRequired: false,
          },
          {
            Condition: "LessThanEqual",
            Property: "VideoBitDepth",
            Value: "8",
            IsRequired: false,
          },
        ],
      },
    ],
    // Embed ASS so Jellyfin allows DirectPlay (Drop/omit forces Transcode).
    // Do NOT Encode/burn PGS — that forces HLS. Native sideloads VTT separately.
    SubtitleProfiles: [
      { Format: "vtt", Method: "External" },
      { Format: "srt", Method: "External" },
      { Format: "subrip", Method: "External" },
      { Format: "ass", Method: "Embed" },
      { Format: "ssa", Method: "Embed" },
      { Format: "pgssub", Method: "Drop" },
      { Format: "pgs", Method: "Drop" },
    ],
    ResponseProfiles: [],
  };
}

/**
 * Browser-safe profile. Do NOT advertise DTS/TrueHD/EAC3/AC3 as DirectPlay —
 * Chromium will play video and silently drop unsupported audio.
 */
function browserDeviceProfile(maxStreamingBitrate: number) {
  // No AC3/DTS/TrueHD/FLAC in DirectPlay — Chrome plays video and drops them silently.
  const videoAudio = "aac,mp3,opus,vorbis";
  const videoCodecs = "h264,vp8,vp9,av1";
  const maxBitrate = clampStreamingBitrate(maxStreamingBitrate);
  return {
    Name: "Reclinarr Web",
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: maxBitrate,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: [
      {
        Container: "mp4,m4v,mov",
        Type: "Video",
        VideoCodec: videoCodecs,
        AudioCodec: videoAudio,
      },
      {
        Container: "webm",
        Type: "Video",
        VideoCodec: "vp8,vp9,av1",
        AudioCodec: "vorbis,opus",
      },
      {
        Container: "mkv",
        Type: "Video",
        VideoCodec: videoCodecs,
        AudioCodec: videoAudio,
      },
      { Container: "mp3", Type: "Audio", AudioCodec: "mp3" },
      { Container: "mp4,m4a,aac", Type: "Audio", AudioCodec: "aac" },
      { Container: "webm,webma,opus", Type: "Audio", AudioCodec: "opus" },
    ],
    TranscodingProfiles: [
      {
        Container: "ts",
        Type: "Video",
        VideoCodec: "h264",
        AudioCodec: "aac",
        Protocol: "hls",
        Context: "Streaming",
        MaxAudioChannels: "2",
        // Wait for two segments so the first playhead second is already buffered.
        MinSegments: 2,
        // true makes playlist times drift from sample PTS and hls.js can
        // loop-load the same two segments after a stall/seek.
        BreakOnNonKeyFrames: false,
      },
      {
        Container: "mp4",
        Type: "Video",
        VideoCodec: "h264",
        AudioCodec: "aac",
        Protocol: "http",
        Context: "Streaming",
        MaxAudioChannels: "2",
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      {
        Type: "VideoAudio",
        Codec: "aac",
        Conditions: [
          {
            Condition: "LessThanEqual",
            Property: "AudioChannels",
            Value: "2",
            IsRequired: false,
          },
        ],
      },
    ],
    SubtitleProfiles: [
      { Format: "vtt", Method: "External" },
      { Format: "srt", Method: "External" },
      { Format: "ass", Method: "Encode" },
      { Format: "ssa", Method: "Encode" },
      { Format: "pgssub", Method: "Encode" },
    ],
    ResponseProfiles: [],
  };
}

/**
 * Turn a Jellyfin-supplied or client-supplied path into a same-origin relative
 * path+query under `baseUrl`. Rejects off-host absolute URLs and `..`.
 */
export function normalizeJellyfinRelativePath(
  raw: string,
  baseUrl: string,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("..")) return null;

  let pathAndQuery: string;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    let absolute: URL;
    try {
      absolute = new URL(trimmed);
    } catch {
      return null;
    }
    let base: URL;
    try {
      base = new URL(baseUrl);
    } catch {
      return null;
    }
    if (absolute.origin !== base.origin) return null;
    if (absolute.username || absolute.password) return null;
    pathAndQuery = `${absolute.pathname}${absolute.search}`;
  } else if (trimmed.includes("://")) {
    return null;
  } else {
    pathAndQuery = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  if (pathAndQuery.includes("..")) return null;
  return pathAndQuery;
}

/** Allow only video/audio/hls media endpoints — not general Jellyfin API paths. */
export function isJellyfinMediaPath(pathAndQuery: string): boolean {
  const path = pathAndQuery.split("?")[0]?.toLowerCase() ?? "";
  return (
    path.includes("/videos/") ||
    path.includes("/audio/") ||
    path.includes("/mediasource") ||
    path.endsWith(".m3u8") ||
    path.endsWith(".ts") ||
    path.endsWith(".mp4") ||
    path.endsWith(".webm") ||
    path.includes("/hls/") ||
    path.includes("hls1/") ||
    path.includes("/live/")
  );
}

export { ticksToSeconds, itemMatchesTmdb, hasPlayableMedia, extractTmdbId };
