import { useEffect, useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import Video, {
  SelectedTrackType,
  TextTrackType,
  type OnLoadData,
  type OnProgressData,
  type VideoRef,
} from "react-native-video";
import { classifyPlayback, getClient, playbackMediaUrl, textSubtitles } from "@reclinarr/client";
import { isBehindLiveWindowError } from "@reclinarr/shared";
import type { VideoSurfaceProps } from "@reclinarr/native-ui";

/** Keep ExoPlayer near the live edge so short sliding windows don't lag behind. */
const LIVE_BUFFER_CONFIG = {
  minBufferMs: 2_000,
  maxBufferMs: 8_000,
  bufferForPlaybackMs: 1_000,
  bufferForPlaybackAfterRebufferMs: 2_000,
  live: {
    targetOffsetMs: 3_000,
    minOffsetMs: 1_500,
    maxOffsetMs: 10_000,
  },
} as const;

/**
 * iOS AVPlayer + react-native-video remuxes sidecar textTracks via
 * AVMutableComposition — but only skips that path when the URI ends in `.m3u8`.
 * Our HLS proxy URLs do not, so attaching VTT tracks forces a composition and
 * desyncs audio/video. Sidecar subs are unsupported for HLS on iOS anyway.
 */
function shouldSideloadTextTracks(kind: ReturnType<typeof classifyPlayback>): boolean {
  if (Platform.OS === "ios" && kind === "hls") return false;
  return true;
}

/** Seek tolerance in RN-video's iOS unit (1/1000 s). ~2s prefers keyframes over frame-accurate seeks. */
const IOS_HLS_SEEK_TOLERANCE = 2000;

/** react-native-video surface implementing the shared VideoSurfaceProps contract. */
export function NativeVideoSurface(props: VideoSurfaceProps) {
  const ref = useRef<VideoRef>(null);
  const kind = classifyPlayback(props.source);
  const origin = getClient().baseUrl || "http://localhost:8787";
  const videoType = kind === "hls" ? "m3u8" : kind === "mpegts" ? "mpegts" : undefined;
  const sideloadSubs = shouldSideloadTextTracks(kind);

  useEffect(() => {
    props.onSeekRequest?.((seconds) => {
      if (Platform.OS === "ios" && kind === "hls") {
        ref.current?.seek(seconds, IOS_HLS_SEEK_TOLERANCE);
      } else {
        ref.current?.seek(seconds);
      }
    });
  }, [props.onSeekRequest, kind]);

  useEffect(() => {
    props.onTransportReady?.({
      setVolume: () => undefined,
      getVolume: () => 1,
      setMuted: () => undefined,
      getMuted: () => false,
      setRate: (rate) => {
        const v = ref.current as VideoRef & { setRate?: (r: number) => void };
        v?.setRate?.(rate);
      },
      getRate: () => 1,
      requestFullscreen: () => undefined,
      exitFullscreen: () => undefined,
      isFullscreen: () => false,
    });
  }, [props.onTransportReady]);

  const sideloaded = sideloadSubs
    ? textSubtitles(props.subtitleTracks).map((track) => ({
        title: track.label || track.language || "Subtitle",
        language: (track.language?.slice(0, 2).toLowerCase() || "en") as "en",
        type: TextTrackType.VTT,
        uri: playbackMediaUrl(track.url, origin, props.headers["x-reclinarr-session"]),
      }))
    : [];

  const selectedTextTrack =
    !sideloadSubs || props.subtitleIndex == null
      ? { type: SelectedTrackType.DISABLED }
      : { type: SelectedTrackType.INDEX, value: props.subtitleIndex };

  // iOS AVPlayer does not reliably forward custom headers on HLS segments.
  // Auth is in the query string (playbackMediaUrl / playlist rewrite). Keep
  // headers for progressive DirectPlay/DirectStream (single URL).
  const iosHls = Platform.OS === "ios" && kind === "hls";
  const sourceHeaders = iosHls ? undefined : props.headers;
  // RN-video only treats HLS specially when the URI ends in `.m3u8` (composition skip).
  // Our proxy path is `/api/playback/jellyfin/stream/...` — tag the fragment so iOS
  // takes the native HLS path even if textTracks slip through later.
  const playUri =
    iosHls && !props.uri.includes(".m3u8") ? `${props.uri}#.m3u8` : props.uri;
  // Live sliding windows are ~24s; chasing a deep forward buffer makes AVPlayer
  // jump when early segments rotate out and can leave A/V briefly desynced.
  const forwardBufferSec = iosHls ? (props.isLive ? 4 : 8) : undefined;

  return (
    <Video
      ref={ref}
      source={{
        uri: playUri,
        ...(sourceHeaders ? { headers: sourceHeaders } : {}),
        ...(videoType ? { type: videoType } : {}),
        ...(sideloaded.length > 0 ? { textTracks: sideloaded } : {}),
        ...(Platform.OS === "android" && props.isLive
          ? { bufferConfig: LIVE_BUFFER_CONFIG }
          : {}),
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
          duration:
            Number.isFinite(data.seekableDuration) && data.seekableDuration > 0
              ? data.seekableDuration
              : undefined,
          playableDuration:
            Number.isFinite(data.playableDuration) && data.playableDuration > 0
              ? data.playableDuration
              : undefined,
        })
      }
      onBuffer={(e) => props.onBuffer?.({ isBuffering: e.isBuffering })}
      onReadyForDisplay={() => props.onReadyForDisplay?.()}
      onEnd={() => props.onEnd()}
      onError={(e) => {
        const err = e.error;
        const detail =
          err?.errorString ||
          err?.localizedDescription ||
          (err?.code != null ? `code ${err.code}` : null) ||
          "Playback failed";
        const code = err?.errorCode ?? err?.code;
        // Native ExoPlayer already seekToDefaultPosition + prepare for this.
        if (isBehindLiveWindowError(detail, code)) return;
        let where: string;
        try {
          const u = new URL(props.uri);
          where = `${u.host}${u.pathname}`;
        } catch {
          where = props.uri.slice(0, 80);
        }
        console.error("[NativeVideoSurface]", kind, where, detail, err);
        props.onError(`${detail} (${kind} @ ${where})`);
      }}
      selectedTextTrack={selectedTextTrack}
      reportBandwidth
      ignoreSilentSwitch="ignore"
      playInBackground={false}
      controls={false}
      automaticallyWaitsToMinimizeStalling={!props.isLive}
      preferredForwardBufferDuration={forwardBufferSec}
      controlsStyles={{ hideLiveBadge: true }}
    />
  );
}
