import { useEffect, useRef, useState, type Ref } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Media } from "@reclinarr/shared";
import {
  actionLabel,
  canPlayMedia,
  cardBadge,
  formatRuntime,
  myListHas,
  toggleMyList,
} from "@reclinarr/client";
import { Artwork } from "./Artwork.js";
import { isTvFocused, useTvFocusAllowed } from "./focus.js";
import { ChevronDownIcon, DownloadIcon, PlayIcon } from "./icons.js";
import type { NativeLayout } from "./layout.js";
import { colors } from "./theme.js";
import { textShadowStyle } from "./webStyle.js";

/** Grow the hover popover past the resting poster (mostly downward). */
const GROW_Y = 1.14;
/** Netflix TV focus enlarge. */
const FOCUS_SCALE = 1.12;
/** Netflix-ish expand / collapse timing. */
const HOVER_OPEN_MS = 420;
const HOVER_CLOSE_MS = 320;
const OPEN_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const CLOSE_EASE = "cubic-bezier(0.4, 0, 0.7, 0.2)";

function webTransition(property: string, open: boolean): ViewStyle {
  if (Platform.OS !== "web") return {};
  const ms = open ? HOVER_OPEN_MS : HOVER_CLOSE_MS;
  return {
    transitionProperty: property,
    transitionDuration: `${ms}ms`,
    transitionTimingFunction: open ? OPEN_EASE : CLOSE_EASE,
  } as ViewStyle;
}


function cornerKind(media: Media): "play" | "download" | null {
  if (canPlayMedia(media)) return "play";
  if (media.preferredAction === "REQUEST") return "download";
  const seerr = media.availability.find((a) => a.provider === "seerr");
  if (
    seerr?.mediaStatus === "PENDING" ||
    seerr?.mediaStatus === "PROCESSING" ||
    seerr?.requestStatus === "PENDING" ||
    seerr?.requestStatus === "APPROVED"
  ) {
    return "download";
  }
  return null;
}

function watchProgress(media: Media): number | undefined {
  for (const entry of media.availability) {
    if (
      "positionSeconds" in entry &&
      "durationSeconds" in entry &&
      typeof entry.positionSeconds === "number" &&
      typeof entry.durationSeconds === "number" &&
      entry.durationSeconds > 0 &&
      entry.positionSeconds > 30
    ) {
      return Math.min(1, entry.positionSeconds / entry.durationSeconds);
    }
  }
  return undefined;
}

export type PosterCardProps = {
  media: Media;
  layout: NativeLayout;
  onPress: () => void;
  /** Play from the hover panel. Series still open details. */
  onPlay?: () => void;
  onFocusCard?: () => void;
  onBlurCard?: () => void;
  /** Host view of the focusable surface (TV focus restore). */
  focusRef?: Ref<View>;
  /** Draw as focused: native focus was restored without a focus event. */
  forceFocused?: boolean;
  /**
   * Rail-controlled expand. When set, this card is enlarged only while true —
   * the parent owns exclusive hover so moving onto a neighbor closes this one.
   */
  expanded?: boolean;
  onHoverChange?: (hovered: boolean) => void;
  hasTVPreferredFocus?: boolean;
  /** Show D-pad / keyboard focus ring (TV + RN-web 10-foot). */
  showFocusRing?: boolean;
  borderRadius?: number;
  /**
   * `hover` — browser popover panel.
   * `focus` — Google TV / 10-foot scale + ring (Netflix TV).
   * `caption` — mobile title under the poster.
   */
  variant?: "caption" | "hover" | "focus";
  /** 1–10 rank badge for Top 10 rails. */
  rank?: number;
};

export function PosterCard({
  media,
  layout,
  onPress,
  onPlay,
  onFocusCard,
  onBlurCard,
  focusRef,
  forceFocused,
  expanded,
  onHoverChange,
  hasTVPreferredFocus,
  showFocusRing = false,
  borderRadius = 6,
  variant = "caption",
  rank,
}: PosterCardProps) {
  const focusAllowed = useTvFocusAllowed();
  const preferFocus = focusAllowed ? hasTVPreferredFocus : undefined;
  const backdrop = media.metadata.backdropUrl;
  const poster = media.metadata.posterUrl;
  const [source, setSource] = useState<"wide" | "poster" | "none">("wide");
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (forceFocused) setFocused(true);
  }, [forceFocused]);
  const [localHover, setLocalHover] = useState(false);
  const art = source === "none" ? undefined : source === "poster" ? poster : backdrop || poster;
  const corner = cornerKind(media);
  const badge = cardBadge(media);
  const progress = watchProgress(media);
  const hover = variant === "hover";
  const focusStage = variant === "focus";
  const w = layout.cardWidth;
  const h = layout.posterH;
  const ph = Math.round(h * GROW_Y);
  const maxSide = Math.max(0, layout.cardGap - 2);
  const pw = Math.min(Math.round(w * 1.1), w + maxSide * 2);
  const restScale = Math.round((w / pw) * 1000) / 1000;
  const radius = hover || focusStage ? 8 : borderRadius;
  const focusScale = useRef(new Animated.Value(1)).current;
  const meta = [
    media.identity.mediaType === "tv" ? "Series" : media.identity.mediaType === "movie" ? "Movie" : null,
    media.metadata.year ? String(media.metadata.year) : null,
    formatRuntime(media.metadata.runtimeMinutes),
  ]
    .filter(Boolean)
    .join("  ·  ");
  const genres = (media.metadata.genres ?? []).slice(0, 3).join("  ·  ");
  const listType: "movie" | "tv" | null =
    media.identity.mediaType === "movie"
      ? "movie"
      : media.identity.mediaType === "tv" || media.identity.mediaType === "episode"
        ? "tv"
        : null;
  const listTmdb = media.identity.tmdbId;
  const qc = useQueryClient();
  const onListQuery = useQuery({
    queryKey: ["mylist", "has", listType, listTmdb],
    queryFn: () => myListHas(listType!, listTmdb!),
    enabled: Boolean(hover && listType && listTmdb),
  });
  const toggleList = useMutation({
    mutationFn: () => toggleMyList(listType!, listTmdb!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mylist"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
    },
  });
  // Controlled by rail when `expanded` is passed; otherwise local hover.
  const open = expanded ?? localHover;
  // `lifted` keeps the enlarged layout mounted through the close animation.
  const [lifted, setLifted] = useState(false);
  const [popped, setPopped] = useState(false);
  // rest → open (grow); open → closing (shrink) → idle.
  const [scalePhase, setScalePhase] = useState<"idle" | "rest" | "open" | "closing">("idle");
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!hover) return;

    if (open) {
      wasOpen.current = true;
      setLifted(true);
      setPopped(true);
      setScalePhase("rest");
      // Paint resting scale first; otherwise the browser sees scale(1)→scale(1).
      let cancelled = false;
      const t = setTimeout(() => {
        if (!cancelled) setScalePhase("open");
      }, 50);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }

    if (!wasOpen.current) return;
    wasOpen.current = false;
    setScalePhase("closing");
    setPopped(false);
    // Fallback if transitionend does not fire (reduced motion / no CSS).
    const t = setTimeout(() => {
      setScalePhase("idle");
      setLifted(false);
    }, HOVER_CLOSE_MS + 80);
    return () => clearTimeout(t);
  }, [open, hover]);

  function onScaleTransitionEnd(event: { propertyName?: string }) {
    if (event.propertyName && event.propertyName !== "transform") return;
    if (scalePhase !== "closing") return;
    setScalePhase("idle");
    setLifted(false);
  }

  function enter() {
    if (expanded === undefined) setLocalHover(true);
    onHoverChange?.(true);
  }

  function leave() {
    if (expanded === undefined) setLocalHover(false);
    onHoverChange?.(false);
  }

  function renderArt(width: number, height: number, showBadge: boolean) {
    return (
      <>
        {art ? (
          <Artwork
            url={art}
            maxWidth={layout.artMaxWidth}
            style={{ width, height }}
            onError={() => {
              if (source !== "poster" && poster && poster !== art) setSource("poster");
              else setSource("none");
            }}
          />
        ) : (
          <View style={{ width, height, justifyContent: "center" }}>
            <Text style={[styles.placeholderText, { fontSize: layout.titleSize }]} numberOfLines={3}>
              {media.metadata.title}
            </Text>
          </View>
        )}
        {showBadge && badge ? (
          <View style={styles.chip}>
            <Text style={styles.chipText}>{badge}</Text>
          </View>
        ) : null}
        {!showBadge && corner ? (
          <View style={styles.badge}>
            {corner === "play" ? (
              <PlayIcon color={colors.text} size={12} />
            ) : (
              <DownloadIcon color={colors.text} size={12} />
            )}
          </View>
        ) : null}
        {progress != null ? (
          <View style={styles.progress}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
      </>
    );
  }

  useEffect(() => {
    if (!focusStage) return;
    Animated.spring(focusScale, {
      toValue: focused ? FOCUS_SCALE : 1,
      friction: 7,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [focused, focusStage, focusScale]);

  if (focusStage) {
    return (
      <View
        style={{
          width: w,
          height: h,
          marginRight: layout.cardGap,
          zIndex: focused ? 20 : 0,
          alignItems: "center",
          justifyContent: "center",
          overflow: "visible",
        }}
      >
        <Animated.View
          style={{
            width: w,
            height: h,
            transform: [{ scale: focusScale }],
            zIndex: focused ? 20 : 0,
          }}
        >
          <Pressable
            ref={focusRef}
            onPress={onPress}
            focusable={focusAllowed}
            hasTVPreferredFocus={preferFocus}
            onFocus={() => {
              setFocused(true);
              onFocusCard?.();
            }}
            onBlur={() => {
              setFocused(false);
              onBlurCard?.();
            }}
            style={{
              width: w,
              height: h,
              borderRadius: radius,
              backgroundColor: colors.bg2,
              overflow: "hidden",
            }}
          >
            {(state) => {
              const on = focused || isTvFocused(state);
              return (
                <>
                  {renderArt(w, h, true)}
                  {on ? (
                    <View style={[styles.focusRing, { width: w, height: h, borderRadius: radius }]} />
                  ) : null}
                </>
              );
            }}
          </Pressable>
        </Animated.View>
        {focused ? (
          <Text style={[styles.focusTitle, { width: w, top: h + 8 }]} numberOfLines={1}>
            {media.metadata.title}
          </Text>
        ) : null}
      </View>
    );
  }

  if (hover) {
    // Keep horizontal grow inside the gap so the enlarged card does not cover
    // neighbors — otherwise you can never hand off hover to the next title.
    const left = Math.round((w - pw) / 2);
    const top = -6;
    const panelH = 118;
    const fullH = ph + panelH;
    const hot = lifted || open;

    return (
      <View
        {...({ dataSet: { seCard: hot ? "hot" : "1" } } as object)}
        style={{
          width: w,
          height: h,
          marginRight: layout.cardGap,
          position: "relative",
          zIndex: hot ? 30 : 0,
          marginLeft: rank != null ? 18 : 0,
        }}
      >
        {rank != null ? (
          <View style={styles.rankBadge}>
            <Text style={styles.rankText}>{rank}</Text>
          </View>
        ) : null}
        <View
          {...({
            dataSet: { sePop: hot ? (popped ? "1" : "0") : "idle" },
            onMouseEnter: enter,
            onMouseLeave: leave,
          } as object)}
          style={[
            styles.popoverBase,
            hot
              ? ({
                  left,
                  top,
                  width: pw,
                  height: fullH,
                  backgroundColor: popped ? "#181818" : "transparent",
                  boxShadow: popped
                    ? "0 20px 50px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06)"
                    : "0 0 0 0 rgba(0,0,0,0)",
                } as ViewStyle)
              : ({
                  left: 0,
                  top: 0,
                  width: w,
                  height: h,
                  backgroundColor: colors.bg2,
                  boxShadow: "0 0 0 0 rgba(0,0,0,0)",
                } as ViewStyle),
          ]}
        >
          <View
            collapsable={false}
            {...({
              dataSet: { seScale: scalePhase },
              onTransitionEnd: onScaleTransitionEnd,
            } as object)}
            style={[
              styles.scaleLayer,
              {
                ["--se-rest-scale" as string]: String(restScale),
              } as ViewStyle,
            ]}
          >
            <Pressable
              onPress={onPress}
              style={{
                width: hot ? pw : w,
                height: hot ? ph : h,
                borderTopLeftRadius: radius,
                borderTopRightRadius: radius,
                borderBottomLeftRadius: hot ? 0 : radius,
                borderBottomRightRadius: hot ? 0 : radius,
                overflow: "hidden",
                backgroundColor: colors.bg2,
              }}
            >
              {renderArt(hot ? pw : w, hot ? ph : h, true)}
            </Pressable>
            {hot ? (
              <View
                style={[
                  styles.panel,
                  webTransition("opacity, transform", popped),
                  {
                    height: panelH,
                    opacity: popped ? 1 : 0,
                    transform: [{ translateY: popped ? 0 : 16 }],
                    pointerEvents: popped ? "auto" : "none",
                  },
                ]}
              >
                <View style={styles.panelActions}>
                  <Pressable
                    onPress={() => {
                      if (onPlay) onPlay();
                      else onPress();
                    }}
                    style={styles.playCircle}
                    accessibilityLabel="Play"
                  >
                    <PlayIcon color="#000" size={16} />
                  </Pressable>
                  {listType && listTmdb ? (
                    <Pressable
                      onPress={() => toggleList.mutate()}
                      style={styles.infoCircle}
                      accessibilityLabel={onListQuery.data?.onList ? "Remove from My List" : "Add to My List"}
                    >
                      <Text style={styles.listMark}>{onListQuery.data?.onList ? "✓" : "+"}</Text>
                    </Pressable>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={onPress} style={styles.infoCircle} accessibilityLabel="More info">
                    <ChevronDownIcon color="#fff" size={14} />
                  </Pressable>
                </View>
                <Text style={styles.panelTitle} numberOfLines={2}>
                  {media.metadata.title}
                </Text>
                {meta ? <Text style={styles.panelMeta}>{meta}</Text> : null}
                {genres ? <Text style={styles.panelGenres}>{genres}</Text> : null}
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ width: w, marginRight: layout.cardGap, zIndex: focused ? 3 : 0 }}>
      <Pressable
        ref={focusRef}
        onPress={onPress}
        focusable={focusAllowed}
        hasTVPreferredFocus={preferFocus}
        onFocus={() => {
          setFocused(true);
          onFocusCard?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlurCard?.();
        }}
        style={({ pressed }) => [
          {
            width: w,
            height: h,
            borderRadius: radius,
            backgroundColor: colors.bg2,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden" as const,
          },
          pressed && !showFocusRing ? { opacity: 0.9 } : null,
        ]}
      >
        {(state) => {
          const on = showFocusRing && (focused || isTvFocused(state));
          return (
            <>
              {renderArt(w, h, false)}
              {on ? (
                <View style={[styles.focusRing, { width: w, height: h, borderRadius: radius }]} />
              ) : null}
            </>
          );
        }}
      </Pressable>
      <Text
        style={{
          color: colors.text,
          marginTop: layout.cardTextGap,
          fontSize: layout.titleSize,
          lineHeight: layout.titleLine,
          fontWeight: focused ? "700" : "600",
        }}
        numberOfLines={1}
      >
        {media.metadata.title}
      </Text>
      <Text
        style={{
          color: colors.muted,
          marginTop: 1,
          fontSize: layout.metaSize,
          lineHeight: layout.metaLine,
        }}
        numberOfLines={1}
      >
        {actionLabel(media)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  popoverBase: {
    position: "absolute",
    zIndex: 40,
    borderRadius: 8,
    overflow: "hidden",
  },
  scaleLayer: {
    width: "100%",
  },
  focusRing: {
    position: "absolute",
    top: 0,
    left: 0,
    borderWidth: 4,
    borderColor: colors.text,
    pointerEvents: "none",
  },
  focusTitle: {
    position: "absolute",
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    ...textShadowStyle(0, 1, 6, "rgba(0,0,0,0.85)"),
  },
  placeholderText: {
    color: colors.text,
    textAlign: "center",
    padding: 8,
  },
  badge: {
    position: "absolute",
    top: 6,
    left: 6,
    zIndex: 1,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  chip: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(20,20,20,0.82)",
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    pointerEvents: "none",
  },
  chipText: { color: "#fff", fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  progress: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.25)",
    pointerEvents: "none",
  },
  progressFill: { height: 3, backgroundColor: colors.accent },
  panel: {
    backgroundColor: "#181818",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  panelActions: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  playCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  infoCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  listMark: { color: "#fff", fontSize: 18, fontWeight: "700", lineHeight: 20 },
  rankBadge: {
    position: "absolute",
    left: -4,
    bottom: 4,
    zIndex: 2,
    minWidth: 36,
    paddingHorizontal: 4,
    pointerEvents: "none",
  },
  rankText: {
    color: "#fff",
    fontSize: 48,
    fontWeight: "900",
    lineHeight: 48,
    ...textShadowStyle(0, 2, 8, "rgba(0,0,0,0.9)"),
  },
  panelTitle: { color: "#fff", fontSize: 14, fontWeight: "700" },
  panelMeta: { color: "#fff", fontSize: 12, fontWeight: "600", marginTop: 6 },
  panelGenres: { color: "#b3b3b3", fontSize: 12, marginTop: 4 },
});
