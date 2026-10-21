import type {
  EpgProgramme,
  LiveChannel,
  LiveChannelGroup,
  LiveNowNext,
  Media,
  MediaIdentity,
  MediaType,
  PlaybackSource,
  ProviderCapabilities,
  ProviderHealth,
} from "@reclinarr/shared";

export interface MediaProvider {
  id: string;
  capabilities(): ProviderCapabilities;
  health(): Promise<ProviderHealth>;
}

export interface LibraryProvider extends MediaProvider {
  getContinueWatching(userContext: UserContext): Promise<Media[]>;
  getNextUp(userContext: UserContext): Promise<Media[]>;
  getRecentlyAdded(userContext: UserContext): Promise<Media[]>;
  getByJellyfinItemId(userContext: UserContext, itemId: string): Promise<Media | null>;
  findByTmdb(
    userContext: UserContext,
    tmdbId: number,
    mediaType: MediaType,
  ): Promise<Media | null>;
  /** Episode rows for a Jellyfin series item id (SxxExx). */
  listEpisodesForSeries?(userContext: UserContext, seriesItemId: string): Promise<Media[]>;
  /** Browse library movies/series (paginated). */
  listLibrary?(
    userContext: UserContext,
    opts: {
      mediaType: "movie" | "tv";
      startIndex?: number;
      limit?: number;
      search?: string;
      sortBy?: string;
    },
  ): Promise<{ items: Media[]; total: number }>;
}

export interface PlaybackProvider extends MediaProvider {
  resolvePlayback(
    userContext: UserContext,
    identity: MediaIdentity,
    opts?: {
      /** Resume / scrub offset — passed to Jellyfin as StartTimeTicks for HLS transcode. */
      startPositionSeconds?: number;
      audioStreamIndex?: number;
      /** ISO language to select when the file has a matching audio stream. */
      preferredAudioLanguage?: string;
      /** Optional client-measured throughput cap (bits/s). */
      maxStreamingBitrate?: number;
      /**
       * Client capability profile. `ios`/`android` prefer DirectPlay/DirectStream
       * (single URL) so native players are not stuck on HLS segment auth.
       */
      deviceProfile?: "web" | "ios" | "android";
    },
  ): Promise<PlaybackSource | null>;
  reportProgress(
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
  ): Promise<void>;
}

export interface DiscoveryProvider extends MediaProvider {
  discoverTrending(opts?: { page?: number; mediaType?: "movie" | "tv" }): Promise<Media[]>;
  discoverMovies?(opts?: { page?: number; genreId?: number }): Promise<Media[]>;
  discoverTv?(opts?: { page?: number; genreId?: number }): Promise<Media[]>;
  search(query: string, opts?: { page?: number }): Promise<Media[]>;
  getDetails?(mediaType: "movie" | "tv", tmdbId: number): Promise<Media | null>;
  /** Similar / related titles (More Like This). */
  getSimilar?(mediaType: "movie" | "tv", tmdbId: number, opts?: { page?: number }): Promise<Media[]>;
}

export interface MediaRequestSummary {
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
}

export interface RequestProvider extends MediaProvider {
  getRequestAvailability(identity: MediaIdentity): Promise<Media["availability"][number] | null>;
  requestMedia(
    identity: MediaIdentity,
    opts?: { seasons?: number[] | "all"; is4k?: boolean },
  ): Promise<void>;
  listRequests?(opts?: {
    take?: number;
    skip?: number;
    filter?: string;
    mediaType?: "movie" | "tv" | "all";
  }): Promise<{ items: MediaRequestSummary[]; total: number }>;
}

export interface VodProvider extends MediaProvider {
  findVodByTmdb(
    tmdbId: number,
    mediaType: "movie" | "tv",
    opts?: { titleHint?: string; yearHint?: number; preferredLanguages?: string[] },
  ): Promise<Media | null>;
  listEpisodesForSeries?(
    seriesId: number,
    opts?: { seriesTmdbId?: number },
  ): Promise<Media[]>;
  resolveVodPlayback?(identity: MediaIdentity): Promise<PlaybackSource | null>;
}

export interface LiveTvProvider extends MediaProvider {
  listChannelGroups(): Promise<LiveChannelGroup[]>;
  listChannels(opts?: {
    groupId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    favouritesOnly?: boolean;
    favouriteUuids?: string[];
    /** Default: number then name. */
    sort?: "number" | "name" | "name_desc";
  }): Promise<{ items: LiveChannel[]; total: number }>;
  getChannel?(uuid: string): Promise<LiveChannel | null>;
  getNowNext(channelUuids: string[]): Promise<LiveNowNext[]>;
  getGuideWindow(opts: {
    start: string;
    end: string;
  }): Promise<EpgProgramme[]>;
  resolveLivePlayback(channelUuid: string): Promise<PlaybackSource | null>;
}

export interface AcquisitionSourceProvider extends MediaProvider {
  // Phase 5 — resolve AcquisitionSource from identity
}

export interface UserContext {
  jellyfinUserId: string;
  jellyfinAccessToken: string;
  deviceId: string;
  deviceName: string;
}

export const JELLYFIN_CAPABILITIES: ProviderCapabilities = {
  library: true,
  playback: true,
  progress: true,
  transcoding: true,
  discovery: false,
  request: false,
  vod: false,
  liveTv: false,
  epg: false,
  acquisitionSource: false,
};

export const SEERR_CAPABILITIES: ProviderCapabilities = {
  library: false,
  playback: false,
  progress: false,
  transcoding: false,
  discovery: true,
  request: true,
  vod: false,
  liveTv: false,
  epg: false,
  acquisitionSource: false,
};

export const BAZARR_CAPABILITIES: ProviderCapabilities = {
  library: false,
  playback: false,
  progress: false,
  transcoding: false,
  discovery: false,
  request: false,
  vod: false,
  liveTv: false,
  epg: false,
  acquisitionSource: false,
};

export const DISPATCHARR_CAPABILITIES: ProviderCapabilities = {
  library: false,
  playback: true,
  progress: false,
  transcoding: false,
  discovery: false,
  request: false,
  vod: true,
  liveTv: true,
  epg: true,
  acquisitionSource: true,
};
