export { SESSION_COOKIE, SESSION_HEADER } from "./session.js";
export {
  ReclinarrClient,
  createClient,
  configureClient,
  getClient,
  tryGetClient,
  trackTelemetry,
  trackFeature,
  TELEMETRY_FEATURES,
  login,
  logout,
  me,
  health,
  healthProviders,
  home,
  mediaByJellyfin,
  mediaByTmdb,
  mediaAvailability,
  seriesEpisodes,
  mediaSimilar,
  myList,
  myListHas,
  toggleMyList,
  syncPreferences,
  adminServices,
  testAdminService,
  saveAdminService,
  discoverTrending,
  discoverMovies,
  discoverTv,
  catalogRails,
  searchMedia,
  requestMedia,
  startAcquisition,
  getAcquisition,
  cancelAcquisition,
  promoteAcquisition,
  listAcquisitions,
  libraryItems,
  listRequests,
  resolvePlayback,
  measurePlaybackBitrate,
  resolvePlaybackForPlay,
  listPlaybackSubtitles,
  reportProgress,
  reportIptvProgress,
  liveGroups,
  liveChannels,
  liveNow,
  liveGuide,
  toggleLiveFavourite,
  playLiveChannel,
  stopLivePlayback,
} from "./api.js";
export type { ReclinarrClientOptions, LoginResult, TelemetryFeature } from "./api.js";
export {
  mediaHref,
  canPlayMedia,
  formatRuntime,
  actionLabel,
  cardBadge,
  primaryAction,
  requestDownloadPercent,
} from "./media.js";
export type { PrimaryAction, PrimaryActionKind } from "./media.js";
export { splitIntoShelves } from "./catalog.js";
export { maxSeekableSecondsForSource } from "./seek-cap.js";
export {
  classifyPlayback,
  absoluteUrl,
  playbackMediaUrl,
  sessionCookieHeader,
  isIptvProgressSource,
  seekCapForSource,
  textSubtitles,
  withCatalogueDuration,
  formatCacheTtlRemaining,
  resumeSecondsFromSource,
} from "./playback.js";
export type { PlaybackKind } from "./playback.js";
export {
  loadSubtitlePref,
  loadSubtitlePrefSync,
  saveSubtitlePref,
  saveSubtitleOff,
  subtitlePrefForTrack,
  resolveSubtitleIndex,
} from "./subtitle-pref.js";
export type { SubtitlePref } from "./subtitle-pref.js";
export {
  loadAudioLanguagePref,
  loadAudioLanguagePrefSync,
  saveAudioLanguagePref,
} from "./audio-pref.js";
export type {
  AdminServicesResponse,
  ServiceEdit,
  ServiceFieldView,
  ServiceId,
  ServiceTestResult,
  ServiceView,
} from "./admin.js";
export type { UserPreferences, PreferencesResponse } from "./preferences.js";
export { getOrCreateDeviceId } from "./device.js";
export {
  memoryStorage,
  DEVICE_ID_KEY,
  SUBTITLE_PREF_KEY,
  AUDIO_LANG_PREF_KEY,
  BW_PROBE_CACHE_KEY,
} from "./storage.js";
export type { KeyValueStorage } from "./storage.js";
export type {
  PlaybackSurfaceEvents,
  PlaybackSurfaceHandle,
  PlaybackSurfaceAttachOpts,
  PlaybackSurfaceFactory,
} from "./playback-surface.js";
