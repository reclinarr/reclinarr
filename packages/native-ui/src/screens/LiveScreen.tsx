import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ListRenderItem,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { LiveChannel, LiveNowNext } from "@reclinarr/shared";
import {
  liveChannels,
  liveGroups,
  liveNow,
  playLiveChannel,
  toggleLiveFavourite,
  trackFeature,
} from "@reclinarr/client";
import { Artwork } from "../Artwork.js";
import { Button } from "../Button.js";
import { isTvFocused, tvFocusHighlight } from "../focus.js";
import { PlayIcon } from "../icons.js";
import { ChannelListSkeleton } from "../Skeleton.js";
import { colors } from "../theme.js";
import { webBg } from "../webStyle.js";
import type { ScreenChromeProps } from "./types.js";

type FilterItem = { id: string; label: string };

type LiveSort = "number" | "name" | "name_desc";
type ViewMode = "list" | "card";

const SORT_CYCLE: LiveSort[] = ["number", "name", "name_desc"];
const SORT_LABELS: Record<LiveSort, string> = {
  number: "Channel #",
  name: "Name A–Z",
  name_desc: "Name Z–A",
};

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 300;
/** Fixed row heights let the list place a focused row by index, without measuring it. */
const LIST_ROW_H = 64;
const CARD_ROW_H = 250;
const CARD_GAP = 10;

type NowQueryResult = { data?: { items: LiveNowNext[] } };

function combineNow(results: NowQueryResult[]): Map<string, LiveNowNext> {
  const map = new Map<string, LiveNowNext>();
  for (const result of results) {
    for (const item of result.data?.items ?? []) map.set(item.channelUuid, item);
  }
  return map;
}

const channelKey = (item: LiveChannel) => item.uuid;

export function LiveScreen({
  nav,
  header,
  focusMode = "touch",
}: Pick<ScreenChromeProps, "nav" | "header" | "focusMode">) {
  const tv = focusMode === "tv";
  const qc = useQueryClient();
  const { height: windowH } = useWindowDimensions();
  const [groupId, setGroupId] = useState<string | "favourites" | "">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [sort, setSort] = useState<LiveSort>("number");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const searchInputRef = useRef<TextInput>(null);
  const filterScrollRef = useRef<ScrollView>(null);
  const channelListRef = useRef<FlatList<LiveChannel>>(null);
  /** Where the list was last scrolled to; on TV only this code scrolls it. */
  const channelScrollY = useRef(0);
  const filterOffsets = useRef<Record<string, number>>({});
  // Android TV Yoga often collapses flex:1 FlatLists under the filter row to 0 height.
  // Pin an explicit viewport so channels actually paint and can scroll with focus.
  const channelListH = Math.max(280, Math.round(windowH - (tv ? 430 : 360)));
  // iOS: AVPlayer cannot play MPEG-TS. Web: mpegts.js drifts A/V on IPTV PCRs.
  const preferHls = Platform.OS === "ios" || Platform.OS === "web";

  const groups = useQuery({ queryKey: ["live", "groups"], queryFn: () => liveGroups() });
  const filterItems = useMemo<FilterItem[]>(
    () => [
      { id: "", label: "All" },
      { id: "favourites", label: "Favourites" },
      ...(groups.data?.items ?? []).map((g) => ({ id: g.id, label: g.name })),
    ],
    [groups.data?.items],
  );
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Pages load as the list nears its end, so a big lineup never needs a pager.
  const channels = useInfiniteQuery({
    queryKey: ["live", "channels", groupId, query, sort],
    queryFn: ({ pageParam }) =>
      liveChannels({
        groupId: groupId && groupId !== "favourites" ? groupId : undefined,
        favouritesOnly: groupId === "favourites",
        search: query || undefined,
        page: pageParam,
        pageSize: PAGE_SIZE,
        sort,
      }),
    initialPageParam: 1,
    getNextPageParam: (last, all) =>
      all.length * PAGE_SIZE < last.total ? all.length + 1 : undefined,
  });
  const pages = channels.data?.pages;
  const items = useMemo(() => (pages ?? []).flatMap((p) => p.items), [pages]);

  // One now/next query per loaded page keeps each request under the API's 80-channel cap.
  const nowMap = useQueries({
    queries: (pages ?? []).map((p) => {
      const uuids = p.items.map((c) => c.uuid);
      return {
        queryKey: ["live", "now", uuids.join(",")],
        queryFn: () => liveNow(uuids),
        enabled: uuids.length > 0,
        refetchInterval: 60_000,
      };
    }),
    combine: combineNow,
  });

  // A toggle answers with the full favourites list; use it instead of refetching every page.
  const serverFavourites = pages?.[0]?.favourites;
  const [toggledFavourites, setToggledFavourites] = useState<string[] | null>(null);
  useEffect(() => setToggledFavourites(null), [serverFavourites]);
  const favourites = useMemo(
    () => new Set(toggledFavourites ?? serverFavourites ?? []),
    [toggledFavourites, serverFavourites],
  );

  const playMutation = useMutation({
    mutationFn: (uuid: string) => playLiveChannel(uuid, { hls: preferHls }),
    onSuccess: (data, uuid) => {
      trackFeature("live_tune");
      const list = items.map((c) => ({
        uuid: c.uuid,
        name: c.name,
        number: c.number,
      }));
      nav.openPlayer({
        source: data.source,
        title: data.title ?? data.channel?.name ?? "Live TV",
        live: true,
        channelUuid: uuid,
        liveChannels: list.length ? list : [{ uuid, name: data.title ?? "Live TV" }],
      });
    },
  });

  const favMutation = useMutation({
    mutationFn: (uuid: string) => toggleLiveFavourite(uuid),
    onSuccess: (result) => {
      setToggledFavourites(result.favourites);
      if (groupId === "favourites") void qc.invalidateQueries({ queryKey: ["live", "channels"] });
    },
  });

  const cycleSort = () => {
    const idx = SORT_CYCLE.indexOf(sort);
    setSort(SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]!);
  };

  const columns = viewMode === "card" ? 2 : 1;
  const rowH = viewMode === "card" ? CARD_ROW_H : LIST_ROW_H;

  // A new filter, search, sort or view starts at the top.
  useEffect(() => {
    channelScrollY.current = 0;
    channelListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [groupId, query, sort, viewMode]);

  /**
   * Keep the focused row inside the list viewport (D-pad focus does not scroll it).
   * The target comes from the row index alone, and the jump is not animated: a press
   * that lands mid-animation makes Android search for the next row among moving views
   * and focus snaps back several rows.
   */
  const keepInView = useCallback(
    (index: number) => {
      if (!tv) return;
      const top = Math.floor(index / columns) * rowH;
      // Show a row of context on each side when it fits; card rows on a TV barely fit once.
      const margin = Math.max(0, Math.min(rowH, Math.floor((channelListH - rowH) / 2)));
      const viewTop = channelScrollY.current;
      let next = viewTop;
      if (top < viewTop + margin) next = Math.max(0, top - margin);
      else if (top + rowH + margin > viewTop + channelListH) {
        next = top + rowH + margin - channelListH;
      }
      if (next === viewTop) return;
      channelScrollY.current = next;
      channelListRef.current?.scrollToOffset({ offset: next, animated: false });
    },
    [tv, columns, rowH, channelListH],
  );

  const play = playMutation.mutate;
  const toggleFavourite = favMutation.mutate;
  const playEnabled = !playMutation.isPending;
  const renderChannel = useCallback<ListRenderItem<LiveChannel>>(
    ({ item, index }) => {
      const Item = viewMode === "card" ? ChannelCard : ChannelRow;
      return (
        <Item
          channel={item}
          index={index}
          now={nowMap.get(item.uuid)}
          favourite={favourites.has(item.uuid)}
          playEnabled={playEnabled}
          showFocusRing={tv}
          onPlay={play}
          onFav={toggleFavourite}
          onFocusIndex={keepInView}
        />
      );
    },
    [viewMode, nowMap, favourites, playEnabled, tv, play, toggleFavourite, keepInView],
  );
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: rowH, offset: rowH * index, index }),
    [rowH],
  );
  const loadMore = useCallback(() => {
    if (channels.hasNextPage && !channels.isFetchingNextPage) void channels.fetchNextPage();
  }, [channels]);

  return (
    <View style={styles.page}>
      {header}
      <View style={styles.bodyPad}>
        <Pressable
          onPress={() => searchInputRef.current?.focus()}
          onFocus={tv ? () => setSearchFocused(true) : undefined}
          onBlur={tv ? () => setSearchFocused(false) : undefined}
          style={(s) => [
            styles.searchWrap,
            tv && styles.searchWrapTv,
            tv && (searchFocused || isTvFocused(s)) && styles.searchWrapFocused,
          ]}
        >
          <TextInput
            ref={searchInputRef}
            style={[
              styles.search,
              tv && styles.searchTv,
              tv && searchFocused && styles.searchFocused,
            ]}
            focusable={!tv}
            showSoftInputOnFocus
            onFocus={tv ? () => setSearchFocused(true) : undefined}
            onBlur={tv ? () => setSearchFocused(false) : undefined}
            value={search}
            onChangeText={setSearch}
            placeholder="Search channels…"
            placeholderTextColor={searchFocused ? "#444" : colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Pressable>

        <View style={[styles.toolbar, tv && styles.toolbarTv]}>
          <Button
            label={SORT_LABELS[sort]}
            variant="ghost"
            onPress={cycleSort}
            style={styles.toolbarBtn}
            showFocusRing={tv}
          />
          <View style={styles.viewToggle}>
            <Pressable
              onPress={() => setViewMode("list")}
              style={(s) => [
                styles.viewBtn,
                viewMode === "list" && styles.viewBtnOn,
                tv &&
                  isTvFocused(s) &&
                  (viewMode === "list" ? styles.viewBtnFocusedOn : styles.viewBtnFocused),
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: viewMode === "list" }}
              accessibilityLabel="List view"
            >
              {(s) => (
                <Text
                  style={[
                    styles.viewBtnLabel,
                    viewMode === "list" && styles.viewBtnLabelOn,
                    tv && isTvFocused(s) && viewMode !== "list" && styles.viewBtnLabelFocused,
                  ]}
                >
                  List
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setViewMode("card")}
              style={(s) => [
                styles.viewBtn,
                viewMode === "card" && styles.viewBtnOn,
                tv &&
                  isTvFocused(s) &&
                  (viewMode === "card" ? styles.viewBtnFocusedOn : styles.viewBtnFocused),
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: viewMode === "card" }}
              accessibilityLabel="Card view"
            >
              {(s) => (
                <Text
                  style={[
                    styles.viewBtnLabel,
                    viewMode === "card" && styles.viewBtnLabelOn,
                    tv && isTvFocused(s) && viewMode !== "card" && styles.viewBtnLabelFocused,
                  ]}
                >
                  Card
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        <ScrollView
          ref={filterScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.filtersScroll, tv && styles.filtersScrollTv]}
          contentContainerStyle={[styles.filters, tv && styles.filtersTv]}
        >
          {filterItems.map((item) => (
            <FilterChip
              key={item.id || "all"}
              label={item.label}
              active={groupId === item.id}
              compact={tv}
              onPress={() => setGroupId(item.id as string | "favourites" | "")}
              showFocusRing={tv}
              onLayout={(x) => {
                filterOffsets.current[item.id || "all"] = x;
              }}
              onFocus={
                tv
                  ? () => {
                      const x = filterOffsets.current[item.id || "all"] ?? 0;
                      filterScrollRef.current?.scrollTo({
                        x: Math.max(0, x - 48),
                        animated: true,
                      });
                    }
                  : undefined
              }
            />
          ))}
        </ScrollView>

        {channels.isError ? (
          <Text style={styles.error}>{(channels.error as Error).message}</Text>
        ) : null}
        {playMutation.isPending ? (
          <Text style={styles.starting}>Starting live stream…</Text>
        ) : null}
        {playMutation.isError ? (
          <Text style={styles.error}>{(playMutation.error as Error).message}</Text>
        ) : null}
      </View>

      <FlatList
        // FlatList cannot change numColumns in place.
        key={viewMode}
        ref={channelListRef}
        style={[styles.channelListBox, { height: channelListH }]}
        data={items}
        keyExtractor={channelKey}
        renderItem={renderChannel}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.cardRow : undefined}
        getItemLayout={getItemLayout}
        onEndReached={loadMore}
        onEndReachedThreshold={1.5}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        // Detached off-screen rows cannot take D-pad focus, so moving down would stop.
        removeClippedSubviews={false}
        ListEmptyComponent={
          channels.isPending ? (
            <ChannelListSkeleton rows={8} />
          ) : channels.isError ? null : (
            <Text style={styles.empty}>No channels in this group.</Text>
          )
        }
        ListFooterComponent={
          channels.isFetchingNextPage ? (
            <Text style={styles.loadingMore}>Loading more channels…</Text>
          ) : null
        }
      />
    </View>
  );
}

function FilterChip({
  label,
  active,
  compact = false,
  onPress,
  showFocusRing = false,
  onFocus,
  onLayout,
}: {
  label: string;
  active: boolean;
  compact?: boolean;
  onPress: () => void;
  showFocusRing?: boolean;
  onFocus?: () => void;
  onLayout?: (x: number) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onFocus={onFocus}
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.x)}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={(state) => [
        styles.filterChip,
        compact && styles.filterChipCompact,
        active && styles.filterChipActive,
        showFocusRing && isTvFocused(state) && styles.filterChipFocused,
      ]}
    >
      {(state) => (
        <Text
          style={[
            styles.filterChipLabel,
            active && styles.filterChipLabelActive,
            showFocusRing && isTvFocused(state) && styles.filterChipLabelFocused,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function ChannelLogo({
  channel,
  size,
  style,
}: {
  channel: LiveChannel;
  size: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(channel.logoUrl) && !failed;
  return (
    <View style={[{ width: size, height: size, borderRadius: 6, overflow: "hidden" }, style]}>
      {showImage ? (
        <Artwork
          url={channel.logoUrl}
          style={{ width: size, height: size }}
          resizeMode="contain"
          maxWidth={size * 2}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={[styles.logoFallback, { width: size, height: size }]}>
          <Text style={styles.logoFallbackText} numberOfLines={1}>
            {channel.number != null ? String(channel.number) : channel.name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  );
}

function PlayChannelButton({
  enabled,
  onPress,
  onFocus,
  compact = false,
  showFocusRing = false,
}: {
  enabled: boolean;
  onPress: () => void;
  onFocus?: () => void;
  compact?: boolean;
  showFocusRing?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      onFocus={onFocus}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel="Play"
      style={(state) => [
        styles.playBtn,
        compact && styles.playBtnCompact,
        !enabled && styles.playBtnDisabled,
        state.pressed && enabled && styles.playBtnPressed,
        showFocusRing && isTvFocused(state) && styles.playBtnFocused,
      ]}
    >
      <PlayIcon color={colors.text} size={compact ? 14 : 16} />
      <Text style={styles.playBtnLabel}>Play</Text>
    </Pressable>
  );
}

type ChannelItemProps = {
  channel: LiveChannel;
  index: number;
  now?: LiveNowNext;
  favourite: boolean;
  playEnabled: boolean;
  showFocusRing?: boolean;
  onPlay: (uuid: string) => void;
  onFav: (uuid: string) => void;
  onFocusIndex: (index: number) => void;
};

const ChannelRow = memo(function ChannelRow({
  channel,
  index,
  now,
  favourite,
  playEnabled,
  showFocusRing = false,
  onPlay,
  onFav,
  onFocusIndex,
}: ChannelItemProps) {
  const play = () => onPlay(channel.uuid);
  const fireFocus = () => onFocusIndex(index);
  return (
    <View style={styles.row}>
      <Text style={styles.num} numberOfLines={1} adjustsFontSizeToFit>{channel.number ?? ""}</Text>
      <ChannelLogo channel={channel} size={40} style={styles.rowLogo} />
      <Pressable
        onPress={play}
        onFocus={fireFocus}
        disabled={!playEnabled}
        style={(state) => [
          styles.rowBody,
          state.pressed && playEnabled && styles.rowPressed,
          showFocusRing && isTvFocused(state) && tvFocusHighlight,
        ]}
      >
        <Text style={styles.name} numberOfLines={1}>
          {channel.name}
        </Text>
        <Text style={styles.now} numberOfLines={1}>
          {now?.now?.title ?? "No guide data"}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onFav(channel.uuid)}
        onFocus={fireFocus}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={favourite ? "Remove from favourites" : "Add to favourites"}
        style={(state) => [
          styles.rowFav,
          showFocusRing && isTvFocused(state) && styles.rowFavFocused,
        ]}
      >
        <Text style={[styles.rowFavLabel, favourite && styles.rowFavLabelOn]}>
          {favourite ? "★" : "☆"}
        </Text>
      </Pressable>
      <PlayChannelButton
        enabled={playEnabled}
        onPress={play}
        onFocus={fireFocus}
        compact
        showFocusRing={showFocusRing}
      />
    </View>
  );
});

const ChannelCard = memo(function ChannelCard({
  channel,
  index,
  now,
  favourite,
  playEnabled,
  showFocusRing = false,
  onPlay,
  onFav,
  onFocusIndex,
}: ChannelItemProps) {
  const play = () => onPlay(channel.uuid);
  const fireFocus = () => onFocusIndex(index);
  return (
    <Pressable
      onPress={play}
      onFocus={fireFocus}
      disabled={!playEnabled}
      style={(state) => [
        styles.card,
        showFocusRing && isTvFocused(state) && styles.cardFocused,
      ]}
    >
      <View style={styles.cardTop}>
        <ChannelLogo channel={channel} size={56} />
        <Pressable
          onPress={() => onFav(channel.uuid)}
          onFocus={fireFocus}
          hitSlop={8}
          style={(state) => [
            styles.cardFav,
            showFocusRing && isTvFocused(state) && styles.cardFavFocused,
          ]}
        >
          <Text style={styles.cardFavLabel}>{favourite ? "★" : "☆"}</Text>
        </Pressable>
      </View>
      {channel.number != null ? <Text style={styles.cardNum}>{channel.number}</Text> : null}
      <Text style={styles.cardName} numberOfLines={2}>
        {channel.name}
      </Text>
      <Text style={styles.cardNow} numberOfLines={2}>
        {now?.now?.title ?? "No guide data"}
      </Text>
      <PlayChannelButton
        enabled={playEnabled}
        onPress={play}
        onFocus={fireFocus}
        showFocusRing={showFocusRing}
      />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: webBg },
  bodyPad: { paddingHorizontal: 16 },
  searchWrap: { marginBottom: 10 },
  searchWrapTv: {
    marginBottom: 6,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: "transparent",
  },
  searchWrapFocused: {
    borderColor: "#fff",
    backgroundColor: "#fff",
    transform: [{ scale: 1.02 }],
  },
  search: {
    backgroundColor: colors.bg2,
    color: colors.text,
    padding: 12,
    borderRadius: 8,
  },
  searchTv: { paddingVertical: 8 },
  searchFocused: { backgroundColor: "#fff", color: "#111" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginBottom: 10,
  },
  toolbarTv: { marginBottom: 6 },
  toolbarBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  viewToggle: {
    flexDirection: "row",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.bg2,
  },
  viewBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: "transparent",
  },
  viewBtnOn: {
    backgroundColor: colors.text,
  },
  viewBtnFocused: {
    borderColor: colors.focus,
    backgroundColor: colors.focus,
    transform: [{ scale: 1.06 }],
  },
  viewBtnFocusedOn: {
    borderColor: colors.bg,
    transform: [{ scale: 1.06 }],
  },
  viewBtnLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  viewBtnLabelOn: {
    color: colors.bg,
  },
  viewBtnLabelFocused: {
    color: colors.bg,
  },
  // Single horizontal row — never wrap; do not grow (must not crush the channel list).
  filtersScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 12,
    maxHeight: 48,
  },
  filtersScrollTv: { marginBottom: 6 },
  filters: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: 8,
    paddingRight: 8,
    minHeight: 44,
  },
  filtersTv: { minHeight: 38 },
  channelListBox: { paddingHorizontal: 16 },
  cardRow: { gap: CARD_GAP, marginBottom: CARD_GAP },
  loadingMore: { color: colors.muted, fontSize: 13, paddingVertical: 16, textAlign: "center" },
  empty: { color: colors.muted, fontSize: 15, paddingVertical: 24 },
  filterChip: {
    backgroundColor: colors.bg2,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
    flexShrink: 0,
    marginRight: 0,
  },
  filterChipCompact: { paddingVertical: 6, minHeight: 34 },
  filterChipActive: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderColor: "rgba(255,255,255,0.4)",
  },
  filterChipFocused: {
    borderColor: colors.bg,
    backgroundColor: colors.focus,
    transform: [{ scale: 1.06 }],
  },
  filterChipLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  filterChipLabelActive: {
    color: colors.text,
  },
  filterChipLabelFocused: {
    color: colors.bg,
  },
  starting: { color: colors.muted, marginBottom: 8, fontSize: 13 },
  error: { color: colors.danger, marginBottom: 8 },
  row: {
    height: LIST_ROW_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.bg2,
  },
  rowPressed: { backgroundColor: colors.bg1 },
  num: { color: colors.muted, width: 52, fontSize: 14 },
  rowLogo: { backgroundColor: colors.bg2 },
  rowBody: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 16, fontWeight: "600" },
  now: { color: colors.muted, fontSize: 13, marginTop: 2 },
  rowFav: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "transparent",
  },
  rowFavFocused: {
    borderColor: colors.focus,
    backgroundColor: colors.focus,
  },
  rowFavLabel: { color: colors.muted, fontSize: 20, lineHeight: 22 },
  rowFavLabelOn: { color: colors.accent },
  logoFallback: {
    backgroundColor: colors.bg2,
    alignItems: "center",
    justifyContent: "center",
  },
  logoFallbackText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
  },
  card: {
    flex: 1,
    height: CARD_ROW_H - CARD_GAP,
    overflow: "hidden",
    backgroundColor: colors.bg1,
    borderRadius: 10,
    padding: 12,
    minWidth: 0,
    borderWidth: 2,
    borderColor: "transparent",
  },
  cardFocused: {
    borderColor: colors.focus,
    backgroundColor: "rgba(255,255,255,0.14)",
    transform: [{ scale: 1.04 }],
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  cardFav: {
    padding: 4,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "transparent",
  },
  cardFavFocused: {
    borderColor: colors.focus,
    backgroundColor: colors.focus,
  },
  cardFavLabel: { color: colors.accent, fontSize: 18 },
  cardNum: { color: colors.muted, fontSize: 12, marginBottom: 2 },
  cardName: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  cardNow: { color: colors.muted, fontSize: 12, lineHeight: 16, marginBottom: 10 },
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: "transparent",
  },
  playBtnCompact: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 6,
  },
  playBtnDisabled: {
    opacity: 0.45,
  },
  playBtnPressed: {
    opacity: 0.85,
  },
  playBtnFocused: {
    borderColor: colors.focus,
    transform: [{ scale: 1.08 }],
  },
  playBtnLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
});
