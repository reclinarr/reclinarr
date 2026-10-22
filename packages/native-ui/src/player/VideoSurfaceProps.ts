import type { PlaybackSource, SubtitleTrack } from "@reclinarr/shared";

/** Imperative transport controls exposed by the video surface (web / native). */
export type VideoTransport = {
  setVolume: (volume: number) => void;
  getVolume: () => number;
  setMuted: (muted: boolean) => void;
  getMuted: () => boolean;
  setRate: (rate: number) => void;
  getRate: () => number;
  requestFullscreen: () => Promise<void> | void;
  exitFullscreen: () => Promise<void> | void;
  isFullscreen: () => boolean;
  /** Safari / WebKit — show the system AirPlay route picker when available. */
  showAirPlayPicker?: () => void;
  isAirPlayAvailable?: () => boolean;
  isAirPlayActive?: () => boolean;
  /** Subscribe to AirPlay availability / active-route changes (web only). */
  onAirPlayChange?: (listener: () => void) => () => void;
};

/** Props every platform video surface must accept (native Video / web MSE). */
export type VideoSurfaceProps = {
  source: PlaybackSource;
  uri: string;
  headers: Record<string, string>;
  paused: boolean;
  isLive: boolean;
  startPositionSeconds?: number;
  audioTrackIndex?: number | null;
  subtitleIndex?: number | null;
  subtitleTracks: SubtitleTrack[];
  onProgress: (info: {
    currentTime: number;
    duration?: number;
    /** Seconds of media buffered ahead of currentTime (native). */
    playableDuration?: number;
  }) => void;
  onLoad: (info: { duration: number }) => void;
  onEnd: () => void;
  onError: (message: string) => void;
  /** Fired when the decoder is waiting on network / demux (web + native). */
  onBuffer?: (info: { isBuffering: boolean; bufferedFraction?: number }) => void;
  /** First decoded frame is on screen (native SurfaceView / TextureView). */
  onReadyForDisplay?: () => void;
  onSeekRequest?: (seek: (seconds: number) => void) => void;
  onTransportReady?: (transport: VideoTransport) => void;
};
