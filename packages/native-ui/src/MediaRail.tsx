import { useRef, useState, type Ref } from "react";
import { FlatList, Text, View, type LayoutChangeEvent } from "react-native";
import type { Media } from "@reclinarr/shared";
import { canPlayMedia } from "@reclinarr/client";
import { HScroll } from "./HScroll.js";
import { PosterCard } from "./PosterCard.js";
import type { NativeLayout } from "./layout.js";
import { colors } from "./theme.js";
import type { Appearance } from "./screens/types.js";
import { FOCUS_ROOM, HOVER_ROOM } from "./webStyle.js";

export { FOCUS_ROOM };

function cardKey(item: Media, index: number) {
  return item.identity.jellyfinItemId ?? `${item.identity.tmdbId}-${index}`;
}

export function MediaRail({
  title,
  items,
  layout,
  appearance = "native",
  showFocusRing = false,
  railIndex = 0,
  ranked = false,
  onOpen,
  onPlay,
  onFocusCard,
  preferFirst = false,
  onLayout,
  railRef,
}: {
  title: string;
  items: Media[];
  layout: NativeLayout;
  appearance?: Appearance;
  showFocusRing?: boolean;
  /** Earlier rails sit above later ones so hover panels are not covered. */
  railIndex?: number;
  /** Show 1–10 rank badges (Top 10 rails). */
  ranked?: boolean;
  onOpen: (media: Media) => void;
  onPlay?: (media: Media) => void;
  onFocusCard?: () => void;
  preferFirst?: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
  /** Root rail view — used by TV pages to scroll focused rails into the viewport. */
  railRef?: Ref<View>;
}) {
  const browse = appearance === "web";
  // Browser uses hover popovers; Google TV uses D-pad scale cards on the same browse look.
  const hoverRails = browse && !showFocusRing;
  const focusRails = browse && showFocusRing;
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<Media>>(null);
  const visibleRange = useRef({ first: 0, last: 0 });
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 5 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
    const indices = viewableItems.map((item) => item.index).filter((index): index is number => index != null);
    if (indices.length) {
      visibleRange.current = { first: Math.min(...indices), last: Math.max(...indices) };
    }
  }).current;
  const stride = layout.cardWidth + layout.cardGap;

  function hoverIn(key: string) {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setHoveredKey(key);
  }

  function hoverOut(key: string) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // Short delay so moving within the enlarged card does not flicker;
    // entering another card cancels this via hoverIn.
    closeTimer.current = setTimeout(() => {
      setHoveredKey((cur) => (cur === key ? null : cur));
      closeTimer.current = null;
    }, 80);
  }

  const hot = hoveredKey != null;
  const listH = focusRails
    ? (layout.railListH ?? layout.posterH + FOCUS_ROOM)
    : layout.railListH ?? layout.posterH + 40;

  return (
    <View
      ref={railRef}
      onLayout={onLayout}
      {...(hoverRails ? ({ dataSet: { seRail: hot ? "hot" : "1" } } as object) : null)}
      style={{
        position: "relative",
        paddingLeft: layout.pageX,
        // Pull the next rail up under this one; hover panel lives in HOVER_ROOM.
        marginBottom: hoverRails ? layout.railGap - HOVER_ROOM : layout.railGap,
        zIndex: hot ? 1000 : Math.max(1, 200 - railIndex),
        overflow: "visible",
      }}
    >
      <Text
        style={{
          color: browse ? "#fff" : colors.text,
          fontSize: browse ? 18 : layout.railTitleSize,
          fontWeight: browse ? "500" : "700",
          marginBottom: browse ? 4 : 8,
        }}
      >
        {title}
      </Text>
      {hoverRails ? (
        <View
          {...({ dataSet: { seRailTrack: "1" } } as object)}
          style={{
            height: layout.posterH + HOVER_ROOM,
            overflow: "visible",
            pointerEvents: "box-none",
          }}
        >
          <HScroll
            // Tall enough to paint hover panels, but empty HOVER_ROOM must not
            // steal hits from the next rail (pointer-events handled in CSS).
            style={{ height: layout.posterH + HOVER_ROOM }}
            contentContainerStyle={{
              paddingRight: layout.pageX,
              paddingTop: 8,
              paddingBottom: HOVER_ROOM - 8,
              alignItems: "flex-start",
              minHeight: layout.posterH + HOVER_ROOM,
            }}
          >
            {items.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 15 }}>Nothing here yet.</Text>
            ) : (
              items.map((item, index) => {
                const key = cardKey(item, index);
                return (
                  <PosterCard
                    key={key}
                    media={item}
                    layout={layout}
                    variant="hover"
                    borderRadius={8}
                    rank={ranked ? index + 1 : undefined}
                    expanded={hoveredKey === key}
                    onHoverChange={(on) => (on ? hoverIn(key) : hoverOut(key))}
                    onPress={() => onOpen(item)}
                    onPlay={
                      onPlay && canPlayMedia(item) && item.identity.mediaType !== "tv"
                        ? () => onPlay(item)
                        : undefined
                    }
                  />
                );
              })
            )}
          </HScroll>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          data={items}
          style={{ height: listH, overflow: "visible" }}
          contentContainerStyle={{
            paddingRight: layout.pageX,
            alignItems: "flex-start",
            paddingTop: focusRails ? 8 : 0,
            paddingBottom: focusRails ? FOCUS_ROOM - 8 : 0,
          }}
          keyExtractor={(item, i) => cardKey(item, i)}
          getItemLayout={(_, index) => ({ length: stride, offset: stride * index, index })}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({ offset: info.index * stride, animated: false });
          }}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          ListEmptyComponent={<Text style={{ color: colors.muted, fontSize: 15 }}>Nothing here yet.</Text>}
          renderItem={({ item, index }) => (
            <PosterCard
              media={item}
              layout={layout}
              variant={focusRails ? "focus" : "caption"}
              showFocusRing={showFocusRing}
              borderRadius={focusRails ? 8 : showFocusRing ? 4 : 6}
              hasTVPreferredFocus={preferFirst && index === 0 ? true : undefined}
              onFocusCard={() => {
                const range = visibleRange.current;
                if (showFocusRing && (index < range.first || index > range.last)) {
                  listRef.current?.scrollToIndex({
                    index,
                    animated: false,
                    viewPosition: index < range.first ? 0.15 : 0.75,
                  });
                }
                onFocusCard?.();
              }}
              onPress={() => onOpen(item)}
              onPlay={
                onPlay && canPlayMedia(item) && item.identity.mediaType !== "tv"
                  ? () => onPlay(item)
                  : undefined
              }
            />
          )}
        />
      )}
    </View>
  );
}
