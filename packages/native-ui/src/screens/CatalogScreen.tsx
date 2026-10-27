import { useMemo, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { catalogRails } from "@reclinarr/client";
import { Billboard } from "../Billboard.js";
import { MediaRail } from "../MediaRail.js";
import { HomeSkeleton, RailSkeleton } from "../Skeleton.js";
import { openMedia } from "../media-nav.js";
import { recallRailFocus, rememberRailFocus } from "../railFocusMemory.js";
import { colors } from "../theme.js";
import { usePlayMedia } from "../hooks/usePlayMedia.js";
import { measureAndScrollIntoView } from "../tvScroll.js";
import { FOCUS_ROOM, webBg } from "../webStyle.js";
import type { ScreenChromeProps } from "./types.js";

export function catalogQuery(mediaType: "movie" | "tv") {
  return { queryKey: ["catalog", mediaType], queryFn: () => catalogRails(mediaType) };
}

export function CatalogScreen({
  layout,
  nav,
  header,
  mediaType,
  focusMode = "touch",
  appearance = "native",
  pageTitle,
}: ScreenChromeProps & {
  mediaType: "movie" | "tv";
}) {
  const catalog = useQuery(catalogQuery(mediaType));
  const { playMedia, bufferStatus } = usePlayMedia(nav);
  const rows = catalog.data?.rows ?? [];
  const tv = focusMode === "tv";
  const web = appearance === "web";
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const railRefs = useRef<Record<string, View | null>>({});
  const focusedRail = useRef<string | null>(null);
  const focusPage = `catalog:${mediaType}`;
  const [restore] = useState(() => (tv ? recallRailFocus(focusPage, rows) : null));
  const featured = useMemo(() => {
    if (!web) return null;
    for (const row of rows) {
      if (row.items[0]) return row.items[0];
    }
    return null;
  }, [rows, web]);

  const open = (media: Parameters<typeof openMedia>[1]) =>
    openMedia({ navigate: (_n, params) => nav.openDetails(params) }, media);

  function ensureRailVisible(rowId: string) {
    if (!tv) return;
    measureAndScrollIntoView(railRefs.current[rowId], scrollRef, scrollY, layout.height ?? 0, {
      topInset: layout.headerH ?? 0,
      pad: 40,
      bottomExtra: FOCUS_ROOM,
      align: "start",
    });
  }

  function onRailCardFocus(rowId: string) {
    if (focusedRail.current === rowId) return;
    focusedRail.current = rowId;
    ensureRailVisible(rowId);
  }

  function scrollToTop() {
    focusedRail.current = null;
    if (scrollY.current > 0) scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }

  return (
    <View style={[styles.page, web && { backgroundColor: webBg }]}>
      {header}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: 48 }}
        onScroll={tv ? onScroll : undefined}
        scrollEventThrottle={tv ? 16 : undefined}
      >
        {web ? (
          <View style={[styles.titleRow, { paddingTop: (layout.headerH ?? 68) + 12, paddingHorizontal: layout.pageX }]}>
            <Text style={styles.pageTitle}>{pageTitle ?? (mediaType === "movie" ? "Movies" : "Series")}</Text>
          </View>
        ) : null}
        {catalog.isLoading && web ? <HomeSkeleton layout={layout} rails={2} cards={4} /> : null}
        {catalog.isLoading && !web ? (
          <View style={{ marginHorizontal: web ? 0 : 0 }}>
            <RailSkeleton layout={layout} rails={2} cards={4} />
          </View>
        ) : null}
        {catalog.isError ? <Text style={[styles.error, { paddingHorizontal: layout.pageX }]}>{(catalog.error as Error).message}</Text> : null}
        {featured ? (
          <Billboard
            media={featured}
            layout={layout}
            variant="inset"
            focusMode={focusMode}
            busyLabel={playMedia.isPending ? bufferStatus || "Resolving…" : null}
            bufferStatus={bufferStatus}
            preferFocus={!restore}
            onFocusActions={tv ? scrollToTop : undefined}
            onPlay={(media) => {
              rememberRailFocus(focusPage, null);
              playMedia.mutate(media);
            }}
            onInfo={() => {
              rememberRailFocus(focusPage, null);
              open(featured);
            }}
          />
        ) : null}
        {rows.map((row, railIndex) => (
          <MediaRail
            key={row.id}
            title={row.title}
            items={row.items}
            layout={layout}
            appearance={appearance}
            showFocusRing={tv}
            railIndex={railIndex}
            onOpen={(media, index) => {
              rememberRailFocus(focusPage, { rowId: row.id, index });
              open(media);
            }}
            onPlay={(media, index) => {
              rememberRailFocus(focusPage, { rowId: row.id, index });
              playMedia.mutate(media);
            }}
            onFocusCard={tv ? () => onRailCardFocus(row.id) : undefined}
            preferIndex={restore?.rowId === row.id ? restore.index : undefined}
            railRef={tv ? (r) => { railRefs.current[row.id] = r; } : undefined}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 14,
  },
  pageTitle: { color: "#fff", fontSize: 32, fontWeight: "700", letterSpacing: -0.4 },
  error: { color: colors.danger, marginBottom: 16 },
});
