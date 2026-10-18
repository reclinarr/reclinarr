import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { actionLabel, catalogRails } from "@reclinarr/client";
import { Billboard } from "../Billboard.js";
import { MediaRail } from "../MediaRail.js";
import { RailSkeleton } from "../Skeleton.js";
import { openMedia } from "../media-nav.js";
import { colors } from "../theme.js";
import { usePlayMedia } from "../hooks/usePlayMedia.js";
import { measureAndScrollIntoView } from "../tvScroll.js";
import { webBg } from "../webStyle.js";
import type { ScreenChromeProps } from "./types.js";

export function CatalogScreen({
  layout,
  nav,
  header,
  mediaType,
  focusMode = "touch",
  appearance = "native",
  pageTitle,
  searchInput,
}: ScreenChromeProps & {
  mediaType: "movie" | "tv";
  /** Optional custom search field (e.g. TV TvTextInput). */
  searchInput?: (props: {
    value: string;
    onChangeText: (v: string) => void;
  }) => ReactNode;
}) {
  const [search, setSearch] = useState("");
  const catalog = useQuery({
    queryKey: ["catalog", mediaType, search],
    queryFn: () => catalogRails(mediaType, { search: search.trim() || undefined }),
  });
  const { playMedia, bufferStatus } = usePlayMedia(nav);
  const rows = catalog.data?.rows ?? [];
  const tv = focusMode === "tv";
  const web = appearance === "web";
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const railRefs = useRef<Record<string, View | null>>({});
  const featured = useMemo(() => {
    if (!web || search.trim()) return null;
    for (const row of rows) {
      if (row.items[0]) return row.items[0];
    }
    return null;
  }, [rows, search, web]);

  const open = (media: Parameters<typeof openMedia>[1]) =>
    openMedia({ navigate: (_n, params) => nav.openDetails(params) }, media);

  function ensureRailVisible(rowId: string) {
    if (!tv) return;
    measureAndScrollIntoView(railRefs.current[rowId], scrollRef, scrollY, layout.height ?? 0, {
      topInset: layout.headerH ?? 0,
    });
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }

  const filter = searchInput ? (
    searchInput({ value: search, onChangeText: setSearch })
  ) : (
    <TextInput
      style={web ? styles.filterPill : styles.search}
      value={search}
      onChangeText={setSearch}
      placeholder={web ? "Genres" : "Filter library…"}
      placeholderTextColor={web ? "rgba(255,255,255,0.85)" : colors.muted}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );

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
            {filter}
          </View>
        ) : (
          <View style={{ paddingHorizontal: layout.pageX, paddingTop: 8 }}>{filter}</View>
        )}
        {catalog.isLoading ? (
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
            playLabel={
              playMedia.isPending ? bufferStatus || "Resolving…" : actionLabel(featured).replace(/^▶\s*/, "")
            }
            bufferStatus={bufferStatus}
            onPlay={() => playMedia.mutate(featured)}
            onInfo={() => open(featured)}
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
            onOpen={open}
            onPlay={(media) => playMedia.mutate(media)}
            onFocusCard={tv ? () => ensureRailVisible(row.id) : undefined}
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
  filterPill: {
    color: "#fff",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 110,
    fontSize: 16,
  },
  search: {
    backgroundColor: colors.bg2,
    color: colors.text,
    fontSize: 16,
    padding: 12,
    borderRadius: 8,
    marginBottom: 18,
    marginTop: 8,
  },
  error: { color: colors.danger, marginBottom: 16 },
});
