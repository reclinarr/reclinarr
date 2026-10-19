import { useEffect, useState, type ReactNode } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { discoverTrending, home, searchMedia } from "@reclinarr/client";
import type { Media } from "@reclinarr/shared";
import { MediaRail } from "../MediaRail.js";
import { PosterCard } from "../PosterCard.js";
import { CatalogSkeleton, RailSkeleton } from "../Skeleton.js";
import { fieldStyles } from "../fieldStyles.js";
import { openMedia } from "../media-nav.js";
import { colors } from "../theme.js";
import { webBg } from "../webStyle.js";
import type { ScreenChromeProps } from "./types.js";

type HomeRow = { id: string; title: string; items: Media[] };

export function SearchScreen({
  layout,
  nav,
  header,
  focusMode = "touch",
  appearance = "native",
  searchInput,
  initialQuery = "",
}: ScreenChromeProps & {
  searchInput?: (props: { value: string; onChangeText: (v: string) => void }) => ReactNode;
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [debouncedQ, setDebouncedQ] = useState(initialQuery.trim());
  const normalizedQ = q.trim();
  const waitingForInput = normalizedQ.length >= 2 && normalizedQ !== debouncedQ;
  const web = appearance === "web";
  useEffect(() => {
    setQ(initialQuery);
    setDebouncedQ(initialQuery.trim());
  }, [initialQuery]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(normalizedQ), 250);
    return () => clearTimeout(timer);
  }, [normalizedQ, initialQuery]);
  const query = useQuery({
    queryKey: ["search", debouncedQ],
    queryFn: () => searchMedia(debouncedQ),
    enabled: debouncedQ.length >= 2,
  });
  const discoverQuery = useQuery({
    queryKey: ["search", "discover"],
    queryFn: async () => {
      const [homeRows, trending] = await Promise.all([
        home().catch(() => ({ rows: [] as HomeRow[] })),
        discoverTrending(1).catch(() => ({ items: [] as Media[] })),
      ]);
      const trendingRow = homeRows.rows.find((r: HomeRow) => r.id === "trending" || r.id === "top10");
      return {
        trending: trendingRow?.items?.length ? trendingRow.items : trending.items,
        popularMovies: homeRows.rows.find((r: HomeRow) => r.id === "popular-movies")?.items ?? [],
        popularSeries: homeRows.rows.find((r: HomeRow) => r.id === "popular-series")?.items ?? [],
      };
    },
    enabled: normalizedQ.length < 2,
    staleTime: 5 * 60_000,
  });
  const tv = focusMode === "tv";
  const cols = layout.gridColumns ?? 2;
  const open = (item: import("@reclinarr/shared").Media) =>
    openMedia({ navigate: (_n, params) => nav.openDetails(params) }, item);

  return (
    <View style={[styles.page, web && { backgroundColor: webBg }]}>
      {header}
      <View
        style={[
          styles.body,
          { paddingHorizontal: layout.pageX, paddingTop: web ? (layout.headerH ?? 68) + 28 : 16 },
        ]}
      >
        {web ? <Text style={styles.heading}>Search</Text> : null}
        <View style={[styles.searchField, web && styles.searchFieldWeb]}>
          <View style={{ flex: 1 }}>
            {searchInput ? searchInput({ value: q, onChangeText: setQ }) : (
              <TextInput
                style={[fieldStyles.input, web ? styles.searchWeb : styles.search]}
                value={q}
                onChangeText={setQ}
                onSubmitEditing={() => setDebouncedQ(normalizedQ)}
                returnKeyType="search"
                placeholder="Search movies and series"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
            )}
          </View>
          {q.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ("")} style={styles.clearSearch}>
            <Text style={styles.clearSearchText}>×</Text>
          </Pressable> : null}
        </View>
        {normalizedQ.length >= 2 && (waitingForInput || (query.isPending && !query.data)) ? (
          <View style={{ marginHorizontal: -layout.pageX }}>
            <CatalogSkeleton layout={layout} cards={cols * 3} />
          </View>
        ) : null}
        {normalizedQ.length >= 2 && !waitingForInput && query.isError ? (
          <View style={styles.searchMessage}>
            <Text style={styles.error}>Search failed: {(query.error as Error).message}</Text>
            <Pressable accessibilityRole="button" onPress={() => void query.refetch()}><Text style={styles.retry}>Try again</Text></Pressable>
          </View>
        ) : null}
        {normalizedQ.length >= 2 && !waitingForInput && query.data ? (
          <FlatList
            data={query.data.items}
            numColumns={cols}
            key={cols}
            columnWrapperStyle={{ gap: layout.cardGap }}
            contentContainerStyle={{ paddingBottom: 32, gap: 12 }}
            keyExtractor={(item, i) => item.identity.jellyfinItemId ?? `${item.identity.tmdbId}-${i}`}
            ListEmptyComponent={<Text style={styles.empty}>No matches.</Text>}
            renderItem={({ item }) => (
              <View style={{ marginBottom: 4 }}>
                <PosterCard
                  media={item}
                  layout={layout}
                  variant={web && tv ? "focus" : web ? "hover" : "caption"}
                  showFocusRing={tv}
                  borderRadius={web || tv ? 8 : 6}
                  onPress={() => open(item)}
                />
              </View>
            )}
          />
        ) : normalizedQ.length < 2 ? (
          <ScrollView
            style={{ marginHorizontal: -layout.pageX }}
            contentContainerStyle={{ paddingBottom: 48 }}
          >
            {discoverQuery.isPending ? <RailSkeleton layout={layout} rails={3} cards={cols} /> : null}
            {(discoverQuery.data?.trending?.length ?? 0) > 0 ? (
              <MediaRail
                title="Trending Now"
                items={discoverQuery.data!.trending}
                layout={layout}
                appearance={appearance}
                showFocusRing={tv}
                railIndex={0}
                onOpen={open}
              />
            ) : null}
            {(discoverQuery.data?.popularMovies?.length ?? 0) > 0 ? (
              <MediaRail
                title="Popular Movies"
                items={discoverQuery.data!.popularMovies}
                layout={layout}
                appearance={appearance}
                showFocusRing={tv}
                railIndex={1}
                onOpen={open}
              />
            ) : null}
            {(discoverQuery.data?.popularSeries?.length ?? 0) > 0 ? (
              <MediaRail
                title="Popular Series"
                items={discoverQuery.data!.popularSeries}
                layout={layout}
                appearance={appearance}
                showFocusRing={tv}
                railIndex={2}
                onOpen={open}
              />
            ) : null}
            {!discoverQuery.isPending &&
            !(discoverQuery.data?.trending?.length ||
              discoverQuery.data?.popularMovies?.length ||
              discoverQuery.data?.popularSeries?.length) ? (
              <Text style={[styles.empty, { paddingHorizontal: layout.pageX }]}>
                Type at least 2 characters to search.
              </Text>
            ) : null}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  heading: { color: "#fff", fontSize: 32, fontWeight: "700", letterSpacing: -0.4, marginBottom: 16 },
  searchField: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  searchFieldWeb: { maxWidth: 480, marginBottom: 20 },
  clearSearch: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: colors.bg2 },
  clearSearchText: { color: colors.text, fontSize: 26, lineHeight: 30 },
  search: {
    marginBottom: 0,
    backgroundColor: colors.bg2,
    color: colors.text,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  searchWeb: {
    marginBottom: 0,
    backgroundColor: "rgba(0,0,0,0.75)",
    color: "#fff",
    borderWidth: 1,
    borderColor: "#fff",
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  empty: { color: colors.muted, fontSize: 15 },
  searchMessage: { paddingVertical: 12, gap: 12 },
  error: { color: colors.danger, fontSize: 15 },
  retry: { color: colors.text, fontSize: 15, fontWeight: "700", textDecorationLine: "underline" },
});
