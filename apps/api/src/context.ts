import {
  BazarrProvider,
  DispatcharrProvider,
  JellyfinProvider,
  MockDispatcharrProvider,
  MockJellyfinProvider,
  MockSeerrProvider,
  SeerrProvider,
  type MediaProvider,
} from "@reclinarr/providers";
import type { AppConfig } from "./config.js";
import { MemoryCache } from "./cache.js";
import { createDb, type AppDb } from "./db/client.js";
import { SessionService } from "./services/session.js";
import { PlaybackResolver } from "./services/playback-resolver.js";
import { AcquisitionManager } from "./services/acquisition-manager.js";
import { LiveFavouritesStore } from "./services/live-favourites.js";
import { MyListStore } from "./services/my-list.js";
import { CacheManager } from "./services/cache-manager.js";
import { IptvConnectionManager } from "./services/iptv-connection-manager.js";
import { IptvProgressStore } from "./services/iptv-progress.js";
import { LiveHlsManager } from "./services/live-hls.js";
import { startVodCatalogSync } from "./services/vod-catalog-sync.js";

export interface AppContext {
  config: AppConfig;
  db: AppDb;
  cache: MemoryCache;
  sessions: SessionService;
  jellyfin: JellyfinProvider | MockJellyfinProvider;
  seerr: SeerrProvider | MockSeerrProvider;
  dispatcharr: DispatcharrProvider | MockDispatcharrProvider;
  bazarr: BazarrProvider;
  providers: MediaProvider[];
  playbackResolver: PlaybackResolver;
  acquisitions: AcquisitionManager;
  liveFavourites: LiveFavouritesStore;
  myList: MyListStore;
  cacheManager: CacheManager;
  iptvConnections: IptvConnectionManager;
  iptvProgress: IptvProgressStore;
  liveHls: LiveHlsManager;
  /** Last authenticated Jellyfin user context used for background library scans. */
  lastLibraryUserContext?: import("@reclinarr/providers").UserContext;
  useMocks: boolean;
}

export function createAppContext(config: AppConfig): AppContext {
  if (config.FFMPEG_PATH) process.env.FFMPEG_PATH = config.FFMPEG_PATH;
  const explicitMocks = Boolean(config.RECLINARR_USE_MOCKS);
  const missingJellyfin = !config.JELLYFIN_URL?.trim();
  // Never treat a missing Jellyfin URL as mocks when other backends are configured —
  // that would accept any password while still driving Seerr/Dispatcharr.
  if (
    missingJellyfin &&
    !explicitMocks &&
    (config.SEERR_URL?.trim() || config.DISPATCHARR_URL?.trim())
  ) {
    throw new Error(
      "JELLYFIN_URL is required unless RECLINARR_USE_MOCKS=true (Seerr/Dispatcharr are configured)",
    );
  }
  if (config.NODE_ENV === "production" && missingJellyfin && !explicitMocks) {
    throw new Error("JELLYFIN_URL is required in production (or set RECLINARR_USE_MOCKS=true)");
  }
  const useMocks = explicitMocks || missingJellyfin;
  const db = createDb(config.RECLINARR_DATA_DIR);
  const cache = new MemoryCache();
  const sessions = new SessionService(db);
  void sessions.purgeExpired();
  const purgeTimer = setInterval(() => {
    void sessions.purgeExpired().catch((err) => {
      console.error("[sessions] purge failed", err);
    });
  }, 60 * 60_000);
  purgeTimer.unref?.();

  const jellyfin = useMocks
    ? new MockJellyfinProvider()
    : new JellyfinProvider({
        baseUrl: config.JELLYFIN_URL,
        timeoutMs: config.HTTP_TIMEOUT_MS,
        reclinarrPublicUrl: config.RECLINARR_PUBLIC_URL,
      });

  const seerr = useMocks
    ? new MockSeerrProvider()
    : new SeerrProvider({
        baseUrl: config.SEERR_URL,
        apiKey: config.SEERR_API_KEY,
        timeoutMs: config.HTTP_TIMEOUT_MS,
      });

  const dispatcharr = useMocks
    ? new MockDispatcharrProvider()
    : new DispatcharrProvider({
        baseUrl: config.DISPATCHARR_URL,
        auth: config.dispatcharrAuth,
        timeoutMs: config.HTTP_TIMEOUT_MS,
        reclinarrPublicUrl: config.RECLINARR_PUBLIC_URL,
        cloudflareAccess: config.dispatcharrCloudflareAccess,
        preferredLanguages: config.RECLINARR_PREFERRED_LANGUAGES,
      });

  const bazarr = new BazarrProvider({
    baseUrl: config.BAZARR_URL,
    apiKey: config.BAZARR_API_KEY,
    timeoutMs: config.HTTP_TIMEOUT_MS,
  });

  const providers: MediaProvider[] = [jellyfin, seerr, dispatcharr, bazarr];
  const liveFavourites = new LiveFavouritesStore(db);
  const myList = new MyListStore(db);
  const cacheManager = new CacheManager(db, {
    maxBytes: config.RECLINARR_CACHE_MAX_BYTES,
    ttlMs: config.RECLINARR_CACHE_TTL_MS,
    // Protect recently played cache files for long watches (default was 5 minutes).
    protectMs: 3 * 60 * 60_000,
    dataDir: config.RECLINARR_DATA_DIR,
  });
  const iptvConnections = new IptvConnectionManager(config.RECLINARR_IPTV_MAX_CONNECTIONS);
  const liveHls = new LiveHlsManager(config.RECLINARR_DATA_DIR, iptvConnections);
  liveHls.start();
  const acquisitions = new AcquisitionManager(
    config.RECLINARR_DATA_DIR,
    dispatcharr,
    db,
    {
      iptvConnections,
      cacheManager,
      cacheTtlMs: config.RECLINARR_CACHE_TTL_MS,
    },
  );
  const iptvProgress = new IptvProgressStore(db);
  const playbackResolver = new PlaybackResolver(
    jellyfin,
    dispatcharr,
    seerr,
    acquisitions,
    db,
    bazarr,
    iptvProgress,
  );

  const ctx: AppContext = {
    config,
    db,
    cache,
    sessions,
    jellyfin,
    seerr,
    dispatcharr,
    bazarr,
    providers,
    playbackResolver,
    acquisitions,
    liveFavourites,
    myList,
    cacheManager,
    iptvConnections,
    iptvProgress,
    liveHls,
    useMocks,
  };

  // Periodic cache eviction
  const evictTimer = setInterval(() => {
    try {
      const n = cacheManager.evict();
      if (n > 0) console.info(`[cache] evicted ${n} acquisition(s)`);
    } catch (err) {
      console.error("[cache] eviction failed", err);
    }
  }, 15 * 60_000);
  evictTimer.unref?.();
  cacheManager.evict();

  acquisitions.setLibraryPromotedHandler(async (localPath) => {
    const userContext = ctx.lastLibraryUserContext;
    if (!userContext) return;
    try {
      await jellyfin.notifyLibraryPathsUpdated(userContext, [localPath]);
    } catch {
      // Path notify can fail if Jellyfin hasn't indexed the folder yet — fall back to scan.
    }
    try {
      await jellyfin.refreshLibrary(userContext);
    } catch (err) {
      console.error("[jellyfin] library refresh after promote failed", err);
    }
  });

  acquisitions.setLibraryMetaResolver(async (identity) => {
    const tmdbId = identity.tmdbId;
    if (!tmdbId || !seerr.getDetails) return undefined;
    const kind =
      identity.mediaType === "episode" || identity.mediaType === "tv" ? "tv" : "movie";
    const media = await seerr.getDetails(kind, tmdbId).catch(() => null);
    if (!media) return undefined;
    return {
      title: media.metadata.title,
      year: media.metadata.year,
      seriesTitle: kind === "tv" ? media.metadata.title : undefined,
      seasonNumber: identity.seasonNumber,
      episodeNumber: identity.episodeNumber,
    };
  });

  // Background warm of hot Seerr titles into the Dispatcharr TMDb index (no full catalogue scan).
  startVodCatalogSync({
    db,
    dispatcharr: dispatcharr as DispatcharrProvider,
    seerr,
    preferredLanguages: config.RECLINARR_PREFERRED_LANGUAGES,
    intervalMs: config.RECLINARR_VOD_SYNC_INTERVAL_MS,
    enabled:
      !useMocks &&
      Boolean(config.DISPATCHARR_URL?.trim()) &&
      Boolean(config.SEERR_URL?.trim()) &&
      dispatcharr instanceof DispatcharrProvider,
  });

  return ctx;
}
