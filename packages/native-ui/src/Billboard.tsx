import { createElement, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Media } from "@reclinarr/shared";
import { formatRuntime, mediaByTmdb, primaryAction } from "@reclinarr/client";
import { usePreferredFocusOnce, useTvFocusAllowed } from "./focus.js";
import { useMediaRequest } from "./hooks/useMediaRequest.js";
import { useTitleDownload } from "./hooks/useTitleDownload.js";
import { Artwork } from "./Artwork.js";
import { PillButton } from "./Button.js";
import type { NativeLayout } from "./layout.js";
import { Shade } from "./Shade.js";
import { textShadowStyle, webBg } from "./webStyle.js";

function metaLine(media: Media): string {
  const kind =
    media.identity.mediaType === "tv" ? "Series" : media.identity.mediaType === "movie" ? "Movie" : null;
  return [kind, media.metadata.genres?.[0], media.metadata.year ? String(media.metadata.year) : null, formatRuntime(media.metadata.runtimeMinutes)]
    .filter(Boolean)
    .join("   ·   ");
}

export function Billboard({
  media,
  layout,
  variant,
  busyLabel,
  onPlay,
  onInfo,
  bufferStatus,
  focusMode = "touch",
  preferFocus = true,
  onFocusActions,
}: {
  media: Media;
  layout: NativeLayout;
  /** Full-bleed home hero, or the rounded panel used on Movies / Series. */
  variant: "bleed" | "inset";
  /** Replaces the Play label while playback is resolving/buffering. */
  busyLabel?: string | null;
  /** Receives the title with live request state (it may have just become playable). */
  onPlay: (media: Media) => void;
  onInfo: () => void;
  bufferStatus?: string | null;
  focusMode?: "touch" | "tv";
  /** TV: primary action takes D-pad focus on mount (off when a rail card is being restored). */
  preferFocus?: boolean;
  /** TV: one of the hero buttons took D-pad focus (pages scroll back to the top). */
  onFocusActions?: () => void;
}) {
  const focusAllowed = useTvFocusAllowed();
  const art = media.metadata.backdropUrl || media.metadata.posterUrl;
  const inset = variant === "inset";
  const requestFlow = useMediaRequest(media);
  const action = requestFlow.action ?? primaryAction(media);
  const playable = action.kind === "play";
  const inProgress = action.kind === "requested" || action.kind === "downloading";
  const download = useTitleDownload(playable ? requestFlow.media : null);
  const tv = focusMode === "tv";
  const initialFocus = usePreferredFocusOnce(focusAllowed && tv && preferFocus);
  const titleSize = tv ? (inset ? 40 : 48) : inset ? 42 : 52;
  const detailType =
    media.identity.mediaType === "movie" || media.identity.mediaType === "tv"
      ? media.identity.mediaType
      : media.identity.mediaType === "episode"
        ? "tv"
        : null;
  const detailTmdb = media.identity.tmdbId;
  const detailsQuery = useQuery({
    queryKey: ["billboard", "trailer", detailType, detailTmdb],
    queryFn: () => mediaByTmdb(detailType!, detailTmdb!),
    enabled:
      Platform.OS === "web" &&
      !tv &&
      Boolean(detailType && detailTmdb) &&
      !media.metadata.trailerYoutubeKey,
    staleTime: 60 * 60_000,
  });
  const youtubeKey =
    media.metadata.trailerYoutubeKey ??
    detailsQuery.data?.media.metadata.trailerYoutubeKey;
  const canPreview = Platform.OS === "web" && Boolean(youtubeKey) && !tv;
  const [trailerOn, setTrailerOn] = useState(false);
  const [muted, setMuted] = useState(true);

  // Delay trailer start slightly so the still art paints first (Netflix-like).
  useEffect(() => {
    setTrailerOn(false);
    setMuted(true);
    if (!canPreview) return;
    const t = setTimeout(() => setTrailerOn(true), 1200);
    return () => clearTimeout(t);
  }, [canPreview, youtubeKey, media.identity.tmdbId]);

  const embedSrc = youtubeKey
    ? `https://www.youtube.com/embed/${encodeURIComponent(youtubeKey)}?autoplay=1&mute=${muted ? 1 : 0}&controls=0&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${encodeURIComponent(youtubeKey)}`
    : null;

  return (
    <View
      style={[
        styles.frame,
        inset
          ? {
              marginHorizontal: layout.pageX,
              height: Math.round(layout.heroH * 0.92),
              borderRadius: 16,
              marginBottom: 22,
            }
          : { height: layout.heroH, marginBottom: -56 },
      ]}
    >
      <Artwork url={art} maxWidth={1600} style={styles.image} />
      {canPreview && trailerOn && embedSrc ? (
        <View style={styles.trailer}>
          {createElement("iframe", {
            title: `${media.metadata.title} trailer`,
            src: embedSrc,
            allow: "autoplay; encrypted-media",
            style: {
              position: "absolute",
              top: "-10%",
              left: "-10%",
              width: "120%",
              height: "120%",
              border: 0,
              pointerEvents: "none",
            },
          })}
        </View>
      ) : null}
      <Shade kind="billboard-vertical" />
      <Shade kind="billboard-left" />
      <View style={[styles.copy, { paddingHorizontal: inset ? 36 : layout.pageX }]}>
        <Text
          style={[styles.title, { fontSize: titleSize, lineHeight: titleSize + 2 }, inset ? styles.titleInset : null]}
          numberOfLines={2}
        >
          {media.metadata.title}
        </Text>
        <Text style={styles.meta}>{metaLine(media)}</Text>
        {media.metadata.overview ? (
          <Text style={styles.overview} numberOfLines={tv ? 2 : 3}>
            {media.metadata.overview}
          </Text>
        ) : null}
        {bufferStatus ? <Text style={styles.buffer}>{bufferStatus}</Text> : null}
        {action.hint ? <Text style={styles.hint}>{action.hint}</Text> : null}
        {requestFlow.error instanceof Error ? (
          <Text accessibilityRole="alert" style={styles.error}>{requestFlow.error.message}</Text>
        ) : null}
        <View style={styles.actions}>
          <PillButton
            icon={playable ? "play" : action.kind === "request" ? "download" : undefined}
            label={playable && busyLabel ? busyLabel : action.label}
            tone="light"
            progress={inProgress ? action.progress : undefined}
            onPress={
              playable
                ? () => onPlay(requestFlow.media ?? media)
                : action.kind === "request"
                  ? requestFlow.request
                  : onInfo
            }
            showFocusRing
            hasTVPreferredFocus={initialFocus.prefer}
            focusRef={initialFocus.ref}
            forceFocused={initialFocus.reclaimed}
            onFocus={() => {
              initialFocus.onFocus();
              onFocusActions?.();
            }}
            onBlur={initialFocus.onBlur}
          />
          {download.state ? (
            <PillButton
              icon={download.state.kind === "download" ? "download" : undefined}
              label={download.state.kind === "downloaded" ? "✓ Downloaded" : download.state.label}
              tone="glass"
              progress={download.state.kind === "downloading" ? download.state.progress : undefined}
              onPress={download.start}
              showFocusRing
              onFocus={onFocusActions}
            />
          ) : null}
          <PillButton
            icon="info"
            label="More Info"
            tone="glass"
            onPress={onInfo}
            showFocusRing
            onFocus={onFocusActions}
          />
          {canPreview && trailerOn ? (
            <Pressable
              onPress={() => setMuted((m) => !m)}
              focusable={focusAllowed}
              style={styles.muteBtn}
              accessibilityLabel={muted ? "Unmute trailer" : "Mute trailer"}
            >
              <Text style={styles.muteText}>{muted ? "Sound" : "Mute"}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    justifyContent: "flex-end",
    overflow: "hidden",
    backgroundColor: webBg,
  },
  image: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  trailer: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
    pointerEvents: "none",
  },
  copy: { paddingBottom: 64, maxWidth: 640, zIndex: 2 },
  title: {
    color: "#fff",
    fontWeight: "800",
    letterSpacing: -0.8,
    ...textShadowStyle(0, 2, 12, "rgba(0,0,0,0.65)"),
  },
  titleInset: {},
  meta: { color: "#fff", fontSize: 15, fontWeight: "600", marginTop: 12 },
  overview: {
    color: "#fff",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 12,
    maxWidth: 520,
    ...textShadowStyle(0, 1, 8, "rgba(0,0,0,0.8)"),
  },
  buffer: { color: "#fff", marginTop: 8, fontSize: 14 },
  hint: {
    color: "rgba(255,255,255,0.85)",
    marginTop: 10,
    fontSize: 14,
    fontWeight: "600",
    ...textShadowStyle(0, 1, 6, "rgba(0,0,0,0.8)"),
  },
  error: { color: "#ff6b6b", marginTop: 8, fontSize: 14 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16, alignItems: "center" },
  muteBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.7)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  muteText: { color: "#fff", fontSize: 13, fontWeight: "600" },
});
