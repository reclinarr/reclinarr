import { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import type { VideoSurfaceProps } from "@reclinarr/native-ui";
import { absolutePlaybackUrl, attachWebPlayback } from "./attach.js";
import { getClient, playbackMediaUrl, SESSION_HEADER, textSubtitles } from "@reclinarr/client";

type WebKitVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitEnterFullscreen?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
  disableRemotePlayback?: boolean;
};

/** Ignore brief HLS segment gaps so the overlay does not flash every couple of seconds. */
const BUFFER_SHOW_MS = 500;

/**
 * RN-web video surface backed by HTMLVideoElement + hls.js/mpegts.js.
 * Opted into Safari AirPlay (native HLS preferred; MSE gets an HLS <source> fallback).
 */
export function WebVideoSurface(props: VideoSurfaceProps) {
  const hostRef = useRef<View>(null);
  const videoRef = useRef<WebKitVideo | null>(null);
  const handleRef = useRef<ReturnType<typeof attachWebPlayback> | null>(null);
  const airplayAvailable = useRef(false);
  const airplayListeners = useRef(new Set<() => void>());
  const transportCb = useRef(props.onTransportReady);
  transportCb.current = props.onTransportReady;

  useEffect(() => {
    const host = hostRef.current as unknown as HTMLElement | null;
    if (!host) return;
    const video = document.createElement("video") as WebKitVideo;
    video.controls = false;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.setAttribute("x-webkit-airplay", "allow");
    video.disableRemotePlayback = false;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "contain";
    video.style.background = "#000";
    // Hide Chromium/WebKit built-in loading spinner — we render BufferingOverlay.
    const hideNativeChrome = document.createElement("style");
    hideNativeChrome.textContent = `
      video::-webkit-media-controls { display: none !important; }
      video::-webkit-media-controls-enclosure { display: none !important; }
      video::-webkit-media-controls-start-playback-button { display: none !important; }
    `;
    host.appendChild(hideNativeChrome);
    host.appendChild(video);
    videoRef.current = video;

    const notifyAirPlay = () => {
      for (const fn of airplayListeners.current) fn();
    };

    const onAvailability = (event: Event) => {
      const availability = (event as Event & { availability?: string }).availability;
      airplayAvailable.current = availability === "available";
      notifyAirPlay();
    };
    const onWireless = () => notifyAirPlay();

    video.addEventListener("webkitplaybacktargetavailabilitychanged", onAvailability);
    video.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", onWireless);

    const fsTarget = () => host.closest("[data-player-root]") ?? host;

    transportCb.current?.({
      setVolume: (v) => {
        video.volume = Math.min(1, Math.max(0, v));
      },
      getVolume: () => video.volume,
      setMuted: (m) => {
        video.muted = m;
      },
      getMuted: () => video.muted,
      setRate: (r) => {
        video.playbackRate = r;
      },
      getRate: () => video.playbackRate,
      requestFullscreen: async () => {
        const el = fsTarget() as HTMLElement;
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        }
      },
      exitFullscreen: async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
      },
      isFullscreen: () => Boolean(document.fullscreenElement),
      showAirPlayPicker: () => {
        video.webkitShowPlaybackTargetPicker?.();
      },
      isAirPlayAvailable: () => airplayAvailable.current,
      isAirPlayActive: () => Boolean(video.webkitCurrentPlaybackTargetIsWireless),
      onAirPlayChange: (listener) => {
        airplayListeners.current.add(listener);
        return () => {
          airplayListeners.current.delete(listener);
        };
      },
    });

    return () => {
      video.removeEventListener("webkitplaybacktargetavailabilitychanged", onAvailability);
      video.removeEventListener("webkitcurrentplaybacktargetiswirelesschanged", onWireless);
      handleRef.current?.destroy();
      handleRef.current = null;
      video.remove();
      videoRef.current = null;
    };
  }, []);

  const seekCb = useRef(props.onSeekRequest);
  seekCb.current = props.onSeekRequest;
  const progressCb = useRef(props.onProgress);
  progressCb.current = props.onProgress;
  const loadCb = useRef(props.onLoad);
  loadCb.current = props.onLoad;
  const endCb = useRef(props.onEnd);
  endCb.current = props.onEnd;
  const errorCb = useRef(props.onError);
  errorCb.current = props.onError;
  const bufferCb = useRef(props.onBuffer);
  bufferCb.current = props.onBuffer;

  // Only report true stalls (waiting/stalled), with hysteresis — not readyState
  // flicker between HLS segments (that was flashing the overlay ~every 2s).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let shown = false;
    let showTimer: ReturnType<typeof setTimeout> | null = null;

    const bufferedFraction = (): number | undefined => {
      try {
        if (!(video.duration > 0) || video.buffered.length === 0) return undefined;
        const end = video.buffered.end(video.buffered.length - 1);
        return Math.min(1, Math.max(0, end / video.duration));
      } catch {
        return undefined;
      }
    };

    const emit = (isBuffering: boolean) => {
      bufferCb.current?.({ isBuffering, bufferedFraction: bufferedFraction() });
    };

    const markWaiting = () => {
      if (shown || showTimer) return;
      showTimer = setTimeout(() => {
        showTimer = null;
        shown = true;
        emit(true);
      }, BUFFER_SHOW_MS);
    };

    const markReady = () => {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      if (!shown) {
        // Still publish fraction on first play without flashing.
        emit(false);
        return;
      }
      shown = false;
      emit(false);
    };

    const onWaiting = () => markWaiting();
    const onStalled = () => markWaiting();
    const onPlaying = () => markReady();
    const onCanPlayThrough = () => markReady();
    const onSeeking = () => markWaiting();
    const onSeeked = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && !video.paused) {
        markReady();
      }
    };
    const onProgress = () => {
      // Update % only — never toggle buffering from readyState (too chatty on HLS).
      if (!shown) return;
      const frac = bufferedFraction();
      if (frac != null) bufferCb.current?.({ isBuffering: true, bufferedFraction: frac });
    };

    // Initial load: wait until we actually stall or we start playing.
    emit(video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplaythrough", onCanPlayThrough);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("progress", onProgress);
    return () => {
      if (showTimer) clearTimeout(showTimer);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplaythrough", onCanPlayThrough);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("progress", onProgress);
    };
  }, [props.uri]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    handleRef.current?.destroy();
    const origin = getClient().baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
    // Prefer PlayerScreen's session-bearing uri so AirPlay receivers can fetch HLS
    // without browser cookies (Apple TV loads the playlist directly).
    const playUrl = props.uri || absolutePlaybackUrl(props.source, origin);
    const source = {
      ...props.source,
      delivery: { ...props.source.delivery, url: playUrl },
    };
    handleRef.current = attachWebPlayback(video, {
      source,
      paused: props.paused,
      startPosition: props.startPositionSeconds,
      onProgress: (info) => progressCb.current(info),
      onLoad: (info) => loadCb.current?.(info),
      onEnd: () => endCb.current(),
      onError: (msg) => errorCb.current(msg),
    });
    // Keep a stable seek bridge so PlayerScreen always has a live seek fn.
    seekCb.current?.((seconds) => handleRef.current?.seek(seconds));
    if (props.paused) handleRef.current.pause();
    else handleRef.current.play();
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // Intentionally re-attach only when the stream identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.uri, props.source.delivery.url, props.source.playSessionId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const origin = getClient().baseUrl || window.location.origin;
    const elements = textSubtitles(props.subtitleTracks).map((subtitle, index) => {
      const element = document.createElement("track");
      element.kind = "subtitles";
      element.label = subtitle.label || subtitle.language || `Track ${index + 1}`;
      element.srclang = subtitle.language || "und";
      element.src = playbackMediaUrl(subtitle.url, origin, props.headers[SESSION_HEADER]);
      video.appendChild(element);
      element.track.mode = props.subtitleIndex === index ? "showing" : "disabled";
      return element;
    });
    return () => elements.forEach((element) => element.remove());
  }, [props.subtitleTracks, props.subtitleIndex, props.headers, props.uri]);

  // Re-publish seek if the parent callback identity changes after attach.
  useEffect(() => {
    props.onSeekRequest?.((seconds) => handleRef.current?.seek(seconds));
  }, [props.onSeekRequest]);

  useEffect(() => {
    if (!handleRef.current) return;
    if (props.paused) handleRef.current.pause();
    else handleRef.current.play();
  }, [props.paused]);

  return <View ref={hostRef} style={styles.fill} />;
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, backgroundColor: "#000" },
});
