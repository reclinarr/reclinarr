import Hls from "hls.js";
import mpegts from "mpegts.js";
import { formatPlaybackIoError, type PlaybackSource } from "@reclinarr/shared";
import {
  classifyPlayback,
  type PlaybackSurfaceAttachOpts,
  type PlaybackSurfaceHandle,
} from "@reclinarr/client";

/**
 * Attach hls.js / mpegts.js / native src to an HTMLVideoElement.
 * Implements the PlaybackSurface contract for browser / RN-web.
 */
export function attachWebPlayback(
  video: HTMLVideoElement,
  opts: PlaybackSurfaceAttachOpts,
): PlaybackSurfaceHandle {
  const { source, onProgress, onEnd, onError, onLoad, startPosition } = opts;
  let destroyed = false;
  let hls: Hls | null = null;
  let mpeg: mpegts.Player | null = null;
  let extraCleanup: (() => void) | null = null;
  /** True once we handed resume to hls.js startPosition (avoid a second currentTime seek). */
  let resumeOwnedByHls = false;
  /** In-player live reloads before bubbling to the app chrome. */
  let liveReloadAttempts = 0;
  const LIVE_RELOAD_MAX = 4;

  const kind = classifyPlayback(source);
  const url = source.delivery.url;
  // Live remux playlists are short sliding windows — VOD-sized buffers fall behind
  // delete_segments and Chromium ends with DEMUXER_ERROR_COULD_NOT_PARSE.
  const isLive =
    Boolean(opts.isLive) ||
    /\/playback\/[^/]+\/live\//.test(url) ||
    /\/live\/[^/]+\/hls\//.test(url);
  const resumeAt =
    startPosition && startPosition > 30 && Number.isFinite(startPosition) ? startPosition : -1;

  const tick = () => {
    if (destroyed) return;
    onProgress({
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
    });
  };

  const onTimeUpdate = () => tick();
  const onLoaded = () => {
    const d = Number.isFinite(video.duration) ? video.duration : 0;
    onLoad?.({ duration: d });
    // One resume seek only — stacking hls startPosition + currentTime seeks desyncs A/V.
    if (!resumeOwnedByHls && resumeAt > 30) {
      try {
        video.currentTime = resumeAt;
      } catch {
        /* ignore */
      }
    }
    if (!opts.paused) void video.play().catch(() => undefined);
  };
  const onEnded = () => onEnd();
  const onVidError = () => {
    if (destroyed) return;
    // Live: try rejoining the edge before surfacing a hard failure.
    if (isLive && liveReloadAttempts < LIVE_RELOAD_MAX) {
      liveReloadAttempts += 1;
      try {
        if (hls) {
          hls.recoverMediaError();
          hls.startLoad();
          return;
        }
        if (mpeg) {
          mpeg.unload();
          mpeg.load();
          return;
        }
        if (video.src) {
          const src = video.src;
          video.src = "";
          video.src = src;
          void video.play().catch(() => undefined);
          return;
        }
      } catch {
        /* fall through */
      }
    }
    // Stop loaders so a demuxer failure does not hammer the playlist endpoint.
    try {
      hls?.stopLoad();
    } catch {
      /* ignore */
    }
    try {
      mpeg?.unload?.();
    } catch {
      /* ignore */
    }
    onError(video.error?.message ?? "Playback failed");
  };

  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("loadedmetadata", onLoaded);
  video.addEventListener("ended", onEnded);
  video.addEventListener("error", onVidError);

  // Prefer Safari native HLS so AirPlay can route the playlist URL (MSE cannot).
  // Chrome 14x also answers canPlayType("maybe"), but its native HLS fails on our
  // EVENT playlists — keep hls.js there.
  const airPlayCapable =
    typeof window !== "undefined" && "WebKitPlaybackTargetAvailabilityEvent" in window;
  const nativeHls =
    kind === "hls" &&
    Boolean(video.canPlayType("application/vnd.apple.mpegurl")) &&
    (airPlayCapable || !Hls.isSupported());

  if (kind === "mpegts" && mpegts.getFeatureList().mseLivePlayback) {
    mpeg = mpegts.createPlayer(
      { type: "mse", isLive: true, url },
      {
        enableWorker: true,
        // Live IPTV: stash buffering delays A/V unequally and drifts lipsync.
        enableStashBuffer: false,
        // Latency chasing seeks/skips and desyncs A/V on noisy IPTV PCRs.
        liveBufferLatencyChasing: false,
        liveSync: false,
        // Fill silent frames on audio timestamp gaps instead of letting A/V drift.
        fixAudioTimestampGap: true,
      },
    );
    mpeg.attachMediaElement(video);
    mpeg.load();
    mpeg.on(
      mpegts.Events.ERROR,
      (
        _t: string,
        _d: unknown,
        info: { code?: number | string; msg?: string; type?: string },
      ) => {
        if (destroyed) return;
        const busy = formatPlaybackIoError(info ?? {});
        if (busy) {
          onError(busy);
          return;
        }
        if (isLive && liveReloadAttempts < LIVE_RELOAD_MAX) {
          liveReloadAttempts += 1;
          try {
            mpeg?.unload();
            mpeg?.load();
            return;
          } catch {
            /* fall through */
          }
        }
        onError(info?.msg ?? "Live stream error");
      },
    );
  } else if (nativeHls) {
    video.src = url;
  } else if (kind === "hls" && Hls.isSupported()) {
    resumeOwnedByHls = !isLive && resumeAt > 30;
    hls = new Hls({
      enableWorker: true,
      startPosition: isLive ? -1 : resumeAt,
      ...(isLive
        ? {
            // Match server sliding window (~12×2s). Buffering 40s of VOD-style
            // forward media makes us chase deleted segments → demuxer parse errors.
            lowLatencyMode: false,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 8,
            liveDurationInfinity: true,
            maxLiveSyncPlaybackRate: 1.2,
            maxBufferLength: 12,
            maxMaxBufferLength: 24,
            maxBufferSize: 30 * 1000 * 1000,
            backBufferLength: 8,
            highBufferWatchdogPeriod: 1,
          }
        : {
            // Keep a healthier forward buffer so we wait for media instead of stuttering.
            maxBufferLength: 40,
            maxMaxBufferLength: 80,
            maxBufferSize: 80 * 1000 * 1000,
            backBufferLength: 30,
          }),
      maxBufferHole: 0.5,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 5,
      // Jellyfin remux/transcode segments can be slow on first hit after seek/reload.
      fragLoadingTimeOut: 30_000,
      fragLoadingMaxRetry: 4,
      fragLoadingRetryDelay: 1_000,
      manifestLoadingTimeOut: 20_000,
      levelLoadingTimeOut: 20_000,
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    // AirPlay needs a real HLS URL; Safari switches to this <source> when casting.
    // Only attach on WebKit — Chromium ignoring MSE + `<source type=mpegURL>` can
    // spam playlist GETs and race the MSE pipeline into demuxer errors.
    // https://webkit.org/blog/15036/how-to-use-media-source-extensions-with-airplay/
    const webkitVideo = video as HTMLVideoElement & {
      webkitCurrentPlaybackTargetIsWireless?: boolean;
      webkitShowPlaybackTargetPicker?: () => void;
    };
    const airplayCapable = typeof webkitVideo.webkitShowPlaybackTargetPicker === "function";
    let airplaySource: HTMLSourceElement | null = null;
    const onWireless = () => {
      const wireless = Boolean(webkitVideo.webkitCurrentPlaybackTargetIsWireless);
      if (wireless) hls?.stopLoad();
      else hls?.startLoad();
    };
    if (airplayCapable) {
      airplaySource = document.createElement("source");
      airplaySource.type = "application/x-mpegURL";
      airplaySource.src = url;
      video.appendChild(airplaySource);
      video.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", onWireless);
    }
    extraCleanup = () => {
      if (airplayCapable) {
        video.removeEventListener("webkitcurrentplaybacktargetiswirelesschanged", onWireless);
      }
      airplaySource?.remove();
    };
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal || destroyed) return;
      const status = (data.response as { code?: number } | undefined)?.code;
      const busy = formatPlaybackIoError({
        code: status,
        msg: data.details || data.error?.message || "",
      });
      // Auto-recover transient network / media errors before surfacing UI —
      // except IPTV slot-full, which will keep failing until the other stream closes.
      if (busy) {
        onError(busy);
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls?.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls?.recoverMediaError();
        // Live windows move on; re-kick loading after recover so we rejoin the edge.
        if (isLive) hls?.startLoad();
        return;
      }
      if (isLive && liveReloadAttempts < LIVE_RELOAD_MAX) {
        liveReloadAttempts += 1;
        try {
          hls?.stopLoad();
          hls?.loadSource(url);
          hls?.startLoad();
          return;
        } catch {
          /* fall through */
        }
      }
      onError(data.details || "HLS error");
    });
    // Successful live joins reset the soft-reload budget.
    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      if (isLive) liveReloadAttempts = 0;
    });
  } else {
    video.src = url;
  }

  return {
    play: () => {
      void video.play().catch(() => undefined);
    },
    pause: () => {
      video.pause();
    },
    seek: (seconds: number) => {
      const target = Math.max(0, seconds);
      try {
        // Prefer seeking inside the current seekable window when present.
        if (video.seekable.length > 0) {
          const start = video.seekable.start(0);
          const end = video.seekable.end(video.seekable.length - 1);
          if (target >= start && target <= end) {
            video.currentTime = target;
            return;
          }
        }
        video.currentTime = target;
      } catch {
        /* ignore */
      }
    },
    destroy: () => {
      destroyed = true;
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onVidError);
      extraCleanup?.();
      extraCleanup = null;
      hls?.destroy();
      hls = null;
      if (mpeg) {
        mpeg.destroy();
        mpeg = null;
      }
      video.removeAttribute("src");
      while (video.firstChild) video.removeChild(video.firstChild);
      video.load();
    },
    getPosition: () => video.currentTime,
    getDuration: () => (Number.isFinite(video.duration) ? video.duration : 0),
  };
}

export function absolutePlaybackUrl(source: PlaybackSource, origin: string): string {
  const url = source.delivery.url;
  if (/^https?:\/\//i.test(url)) return url;
  const base = origin.endsWith("/") ? origin : `${origin}/`;
  return new URL(url.replace(/^\//, ""), base).href;
}
