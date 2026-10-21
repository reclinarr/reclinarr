export { SESSION_COOKIE, SESSION_HEADER } from "./session.js";
export {
  ReclinarrClient,
  createClient,
  configureClient,
  getClient,
  tryGetClient,
  trackTelemetry,
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
export type { ReclinarrClientOptions, LoginResult } from "./api.js";
export {
  mediaHref,
  canPlayMedia,
  formatRuntime,
  actionLabel,
  cardBadge,
} from "./media.js";
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
  saveSubtitleTrack,
  resolveSubtitleIndex,
} from "./subtitle-pref.js";
export type { SubtitlePref } from "./subtitle-pref.js";
export {
  loadAudioLanguagePref,
  loadAudioLanguagePrefSync,
  saveAudioLanguagePref,
} from "./audio-pref.js";
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
