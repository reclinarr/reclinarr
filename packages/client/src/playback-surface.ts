import type { PlaybackSource, SubtitleTrack } from "@reclinarr/shared";

/** Platform player attachment — web MSE vs native ExoPlayer/AVPlayer. */
export type PlaybackSurfaceEvents = {
  onProgress: (info: { currentTime: number; duration: number }) => void;
  onEnd: () => void;
  onError: (message: string) => void;
  onLoad?: (info: { duration: number }) => void;
  onBuffering?: (info: { buffering: boolean }) => void;
};

export type PlaybackSurfaceHandle = {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  destroy: () => void;
  getPosition: () => number;
  getDuration: () => number;
};

export type PlaybackSurfaceAttachOpts = PlaybackSurfaceEvents & {
  source: PlaybackSource;
  startPosition?: number;
  paused?: boolean;
  /** Live IPTV / linear — tune buffering and HLS live sync (web). */
  isLive?: boolean;
  audioTrackIndex?: number | null;
  subtitleTrack?: SubtitleTrack | null | "off";
  headers?: Record<string, string>;
  userAgent?: string;
};

/**
 * Factory implemented per platform.
 * Web: hls.js / mpegts.js + HTMLVideoElement.
 * Native: react-native-video.
 */
export type PlaybackSurfaceFactory = {
  attach: (opts: PlaybackSurfaceAttachOpts) => PlaybackSurfaceHandle | Promise<PlaybackSurfaceHandle>;
};
