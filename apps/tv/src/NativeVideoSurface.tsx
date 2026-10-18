import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import Video, {
  SelectedTrackType,
  TextTrackType,
  type OnLoadData,
  type OnProgressData,
  type VideoRef,
} from "react-native-video";
import {
  classifyPlayback,
  getClient,
  playbackMediaUrl,
  textSubtitles,
} from "@reclinarr/client";
import type { VideoSurfaceProps } from "@reclinarr/native-ui";

export function NativeVideoSurface(props: VideoSurfaceProps) {
  const ref = useRef<VideoRef>(null);
  const kind = classifyPlayback(props.source);
  const origin = getClient().baseUrl || "http://localhost:8787";
  const videoType = kind === "hls" ? "m3u8" : kind === "mpegts" ? "mpegts" : undefined;
  const sessionId = props.headers["x-streamerr-session"];

  useEffect(() => {
    props.onSeekRequest?.((seconds) => ref.current?.seek(seconds));
  }, [props.onSeekRequest]);

  // Reclinarr subtitle proxies always return WebVTT (never .vtt in the path).
  // Auth must be in the query string — ExoPlayer often omits headers on sideload GETs.
  const seenTitles = new Map<string, number>();
  const sideloaded = textSubtitles(props.subtitleTracks).map((track) => {
    const base = (track.label || track.language || "Subtitle").trim() || "Subtitle";
    const n = (seenTitles.get(base) ?? 0) + 1;
    seenTitles.set(base, n);
    const title = n > 1 ? `${base} (${n})` : base;
    return {
      title,
      language: (track.language?.slice(0, 2).toLowerCase() || "en") as "en",
      type: TextTrackType.VTT,
      uri: playbackMediaUrl(track.url, origin, sessionId),
    };
  });

  const selected =
    props.subtitleIndex == null
      ? null
      : sideloaded[props.subtitleIndex] ?? null;

  // Prefer TITLE — ExoPlayer INDEX is per-group and breaks with multiple sideloads.
  const selectedTextTrack =
    selected == null
      ? { type: SelectedTrackType.DISABLED }
      : { type: SelectedTrackType.TITLE, value: selected.title };

  return (
    <Video
      ref={ref}
      source={{
        uri: props.uri,
        headers: props.headers,
        ...(videoType ? { type: videoType } : {}),
        textTracks: sideloaded,
      }}
      style={StyleSheet.absoluteFill}
      paused={props.paused}
      resizeMode="contain"
      onLoad={(data: OnLoadData) => {
        const d = Number.isFinite(data.duration) && data.duration > 0 ? data.duration : 0;
        props.onLoad({ duration: d });
      }}
      onProgress={(data: OnProgressData) =>
        props.onProgress({
          currentTime: data.currentTime,
          playableDuration:
            Number.isFinite(data.playableDuration) && data.playableDuration > 0
              ? data.playableDuration
              : undefined,
        })
      }
      onBuffer={(e) => props.onBuffer?.({ isBuffering: e.isBuffering })}
      onEnd={props.onEnd}
      onError={(e) => props.onError(e.error?.errorString ?? "Playback failed")}
      selectedTextTrack={selectedTextTrack}
      reportBandwidth
      ignoreSilentSwitch="ignore"
      playInBackground={false}
      controls={false}
      // ExoPlayer paints its own always-on LIVE chip; we render ours in chrome.
      controlsStyles={{ hideLiveBadge: true }}
    />
  );
}
