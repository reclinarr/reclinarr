import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ListRenderItem,
  type PressableStateCallbackType,
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
import { displayGroupName, type LiveChannel, type LiveNowNext } from "@reclinarr/shared";
import {
  liveChannels,
  liveGroups,
  liveNow,
  playLiveChannel,
  toggleLiveFavourite,
  trackFeature,
} from "@reclinarr/client";
import { Artwork } from "../Artwork.js";
import { isTvFocused, tvFocusHighlight } from "../focus.js";
import { ChannelListSkeleton } from "../Skeleton.js";
import { colors } from "../theme.js";
import { webBg } from "../webStyle.js";
import type { ScreenChromeProps } from "./types.js";

type FilterItem = { id: string; label: string; count?: number };

type LiveSort = "number" | "name" | "name_desc";

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
const RAIL_ROW_H = 48;
/** Guide layout: group rail on the left, channel list filling the rest. */
const RAIL_W_TV = 280;
const RAIL_W = 260;
/** Below this width the rail folds into a panel opened from a group button. */
const COLLAPSE_RAIL_BELOW_W = 720;

/** RN-web adds `hovered` to the pressable state. */
type PressState = PressableStateCallbackType & { hovered?: boolean };

type NowQueryResult = { data?: { items: LiveNowNext[] } };

function combineNow(results: NowQueryResult[]): Map<string, LiveNowNext> {
  const map = new Map<string, LiveNowNext>();
  for (const result of results) {
    for (const item of result.data?.items ?? []) map.set(item.channelUuid, item);
  }
  return map;
}

const channelKey = (item: LiveChannel) => item.uuid;
const filterKey = (item: FilterItem) => item.id || "all";

/**
 * D-pad focus does not scroll a list, so scroll it to keep the focused row in view.
 * The target comes from the row index alone, and the jump is not animated: a press
 * that lands mid-animation makes Android search for the next row among moving views
 * and focus snaps back several rows.
 */
function useKeepFocusedRowInView<T>(
  listRef: RefObject<FlatList<T> | null>,
  { enabled, rowH, viewportH }: { enabled: boolean; rowH: number; viewportH: number },
) {
  /** Where the list was last scrolled to; on TV only this code scrolls it. */
  const scrollY = useRef(0);
  const keepInView = useCallback(
    (index: number) => {
      if (!enabled) return;
      const top = index * rowH;
      // Show a row of context on each side when it fits.
      const margin = Math.max(0, Math.min(rowH, Math.floor((viewportH - rowH) / 2)));
      const viewTop = scrollY.current;
      let next = viewTop;
      if (top < viewTop + margin) next = Math.max(0, top - margin);
      else if (top + rowH + margin > viewTop + viewportH) next = top + rowH + margin - viewportH;
      if (next === viewTop) return;
      scrollY.current = next;
      listRef.current?.scrollToOffset({ offset: next, animated: false });
    },
    [enabled, rowH, viewportH, listRef],
  );
  const scrollToTop = useCallback(() => {
    scrollY.current = 0;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [listRef]);
  return { keepInView, scrollToTop };
}

export function LiveScreen({
  nav,
  header,
  focusMode = "touch",
  insetX = 16,
}: Pick<ScreenChromeProps, "nav" | "header" | "focusMode"> & {
  /** Page margin, so the rail and list line up with the header's title. */
  insetX?: number;
}) {
  const tv = focusMode === "tv";
  const qc = useQueryClient();
  const { width: windowW, height: windowH } = useWindowDimensions();
  const collapsible = !tv && windowW < COLLAPSE_RAIL_BELOW_W;
  const [railOpen, setRailOpen] = useState(false);
  const [groupId, setGroupId] = useState<string | "favourites" | "">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [sort, setSort] = useState<LiveSort>("number");
  const searchInputRef = useRef<TextInput>(null);
  const channelListRef = useRef<FlatList<LiveChannel>>(null);
  const railListRef = useRef<FlatList<FilterItem>>(null);
  // Android TV Yoga often collapses flex:1 FlatLists to 0 height, so lists get an explicit
  // height measured from a plain flex:1 wrapper.
  const [measuredListH, setMeasuredListH] = useState(0);
  const [railListH, setRailListH] = useState(0);
  const channelListH = measuredListH || Math.max(280, windowH - (tv ? 140 : 260));
  // iOS: AVPlayer cannot play MPEG-TS. Web: mpegts.js drifts A/V on IPTV PCRs.
  const preferHls = Platform.OS === "ios" || Platform.OS === "web";

  useEffect(() => {
    if (!collapsible) setRailOpen(false);
  }, [collapsible]);

  const groups = useQuery({ queryKey: ["live", "groups"], queryFn: () => liveGroups() });
  const groupItems = groups.data?.items;
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

  const filterItems = useMemo<FilterItem[]>(() => {
    const list = groupItems ?? [];
    return [
      { id: "", label: "All", count: list.reduce((n, g) => n + (g.channelCount ?? 0), 0) || undefined },
      { id: "favourites", label: "Favourites", count: favourites.size },
      ...list.map((g) => ({ id: g.id, label: displayGroupName(g.name), count: g.channelCount })),
    ];
  }, [groupItems, favourites]);
  const activeFilter = filterItems.find((f) => f.id === groupId) ?? filterItems[0]!;

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
  const selectGroup = useCallback((id: string) => {
    setGroupId(id);
    setRailOpen(false);
  }, []);

  const { keepInView, scrollToTop } = useKeepFocusedRowInView(channelListRef, {
    enabled: tv,
    rowH: LIST_ROW_H,
    viewportH: channelListH,
  });
  const rail = useKeepFocusedRowInView(railListRef, {
    enabled: tv,
    rowH: RAIL_ROW_H,
    viewportH: railListH,
  });

  // A new filter, search or sort starts at the top.
  useEffect(() => {
    scrollToTop();
  }, [groupId, query, sort, scrollToTop]);

  const play = playMutation.mutate;
  const toggleFavourite = favMutation.mutate;
  const playEnabled = !playMutation.isPending;
  const renderChannel = useCallback<ListRenderItem<LiveChannel>>(
    ({ item, index }) => (
      <ChannelRow
        channel={item}
        index={index}
        now={nowMap.get(item.uuid)}
        favourite={favourites.has(item.uuid)}
        playEnabled={playEnabled}
        tv={tv}
        narrow={collapsible}
        onPlay={play}
        onFav={toggleFavourite}
        onFocusIndex={keepInView}
      />
    ),
    [nowMap, favourites, playEnabled, tv, collapsible, play, toggleFavourite, keepInView],
  );
  const renderRailItem = useCallback<ListRenderItem<FilterItem>>(
    ({ item, index }) => (
      <RailItem
        item={item}
        index={index}
        active={groupId === item.id}
        tv={tv}
        onSelect={selectGroup}
        onFocusIndex={rail.keepInView}
      />
    ),
    [groupId, tv, selectGroup, rail.keepInView],
  );
  const getRailItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: RAIL_ROW_H, offset: RAIL_ROW_H * index, index }),
    [],
  );
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: LIST_ROW_H, offset: LIST_ROW_H * index, index }),
    [],
  );
  const loadMore = useCallback(() => {
    if (channels.hasNextPage && !channels.isFetchingNextPage) void channels.fetchNextPage();
  }, [channels]);

  const searchBox = (
    <Pressable
      onPress={() => searchInputRef.current?.focus()}
      onFocus={tv ? () => setSearchFocused(true) : undefined}
      onBlur={tv ? () => setSearchFocused(false) : undefined}
      style={(s) => [
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
  );
  const status = (
    <>
      {channels.isError ? (
        <Text style={styles.error}>{(channels.error as Error).message}</Text>
      ) : null}
      {playMutation.isPending ? (
        <Text style={styles.starting}>Starting live stream…</Text>
      ) : null}
      {playMutation.isError ? (
        <Text style={styles.error}>{(playMutation.error as Error).message}</Text>
      ) : null}
    </>
  );
  const railList = (
    <View
      style={styles.fill}
      onLayout={(e) => setRailListH(Math.floor(e.nativeEvent.layout.height))}
    >
      <FlatList
        ref={railListRef}
        style={{ height: railListH }}
        data={filterItems}
        keyExtractor={filterKey}
        renderItem={renderRailItem}
        getItemLayout={getRailItemLayout}
        removeClippedSubviews={false}
      />
    </View>
  );
  const sortRow = (
    <View style={styles.railSort}>
      <Pressable
        onPress={cycleSort}
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${SORT_LABELS[sort]}`}
        style={(state: PressState) => [
          styles.railItem,
          styles.railSortItem,
          (state.hovered || state.pressed) && styles.railItemHovered,
          tv && isTvFocused(state) && styles.railItemFocused,
        ]}
      >
        {(state) => {
          const focused = tv && isTvFocused(state);
          return (
            <>
              <Text style={[styles.railLabel, focused && styles.railLabelFocused]}>Sort</Text>
              <Text style={[styles.railSortValue, focused && styles.railLabelFocused]}>
                {SORT_LABELS[sort]}
              </Text>
            </>
          );
        }}
      </Pressable>
    </View>
  );
  const channelList = (
    <FlatList
      ref={channelListRef}
      style={{
        height: channelListH,
        paddingLeft: collapsible ? insetX : 16,
        paddingRight: insetX,
      }}
      data={items}
      keyExtractor={channelKey}
      renderItem={renderChannel}
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
  );

  return (
    <View style={styles.page}>
      {header}
      {collapsible ? (
        <View style={[styles.compactBar, { paddingHorizontal: insetX }]}>
          <Pressable
            onPress={() => setRailOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel="Channel groups"
            accessibilityState={{ expanded: railOpen }}
            style={(state: PressState) => [
              styles.groupButton,
              (state.hovered || state.pressed || railOpen) && styles.groupButtonOn,
            ]}
          >
            <Text style={styles.groupButtonIcon}>☰</Text>
            <Text style={styles.groupButtonLabel} numberOfLines={1}>
              {activeFilter.label}
            </Text>
            {activeFilter.count != null ? (
              <Text style={styles.railCount}>{activeFilter.count}</Text>
            ) : null}
          </Pressable>
          <View style={styles.fill}>{searchBox}</View>
        </View>
      ) : null}
      <View style={[styles.body, { paddingLeft: collapsible ? 0 : insetX }]}>
        {collapsible ? null : (
          <View style={{ width: tv ? RAIL_W_TV : RAIL_W }}>
            <View style={styles.railSearch}>{searchBox}</View>
            {railList}
            {sortRow}
          </View>
        )}
        <View style={styles.main}>
          {status}
          <View
            style={styles.fill}
            onLayout={(e) => setMeasuredListH(Math.floor(e.nativeEvent.layout.height))}
          >
            {channelList}
          </View>
        </View>
        {collapsible && railOpen ? (
          <>
            <Pressable
              style={styles.backdrop}
              onPress={() => setRailOpen(false)}
              accessibilityLabel="Close channel groups"
            />
            <View style={styles.drawer}>
              {railList}
              {sortRow}
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

const RailItem = memo(function RailItem({
  item,
  index,
  active,
  tv,
  onSelect,
  onFocusIndex,
}: {
  item: FilterItem;
  index: number;
  active: boolean;
  tv: boolean;
  onSelect: (id: string) => void;
  onFocusIndex: (index: number) => void;
}) {
  return (
    <Pressable
      onPress={() => onSelect(item.id)}
      onFocus={() => onFocusIndex(index)}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={(state: PressState) => [
        styles.railItem,
        active && styles.railItemActive,
        !active && (state.hovered || state.pressed) && styles.railItemHovered,
        tv && isTvFocused(state) && styles.railItemFocused,
      ]}
    >
      {(state) => {
        const focused = tv && isTvFocused(state);
        return (
          <>
            <Text
              style={[
                styles.railLabel,
                active && styles.railLabelActive,
                focused && styles.railLabelFocused,
              ]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
            {item.count != null ? (
              <Text style={[styles.railCount, focused && styles.railLabelFocused]}>
                {item.count}
              </Text>
            ) : null}
          </>
        );
      }}
    </Pressable>
  );
});

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

/** Pressing or clicking a row plays it; the star is the only other action. */
const ChannelRow = memo(function ChannelRow({
  channel,
  index,
  now,
  favourite,
  playEnabled,
  tv,
  narrow,
  onPlay,
  onFav,
  onFocusIndex,
}: {
  channel: LiveChannel;
  index: number;
  now?: LiveNowNext;
  favourite: boolean;
  playEnabled: boolean;
  tv: boolean;
  narrow: boolean;
  onPlay: (uuid: string) => void;
  onFav: (uuid: string) => void;
  onFocusIndex: (index: number) => void;
}) {
  const fireFocus = () => onFocusIndex(index);
  const nowTitle = now?.now?.title;
  return (
    <View style={styles.row}>
      <Text style={[styles.num, narrow && styles.numNarrow]} numberOfLines={1} adjustsFontSizeToFit>
        {channel.number ?? ""}
      </Text>
      <ChannelLogo channel={channel} size={40} style={styles.rowLogo} />
      <Pressable
        onPress={() => onPlay(channel.uuid)}
        onFocus={fireFocus}
        disabled={!playEnabled}
        accessibilityRole="button"
        accessibilityLabel={`Play ${channel.name}`}
        style={(state: PressState) => [
          styles.rowBody,
          !tv && styles.rowBodyTouch,
          (state.hovered || state.pressed) && playEnabled && styles.rowHovered,
          tv && isTvFocused(state) && tvFocusHighlight,
        ]}
      >
        <Text style={styles.name} numberOfLines={1}>
          {channel.name}
        </Text>
        {nowTitle ? (
          <Text style={styles.now} numberOfLines={1}>
            {nowTitle}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        onPress={() => onFav(channel.uuid)}
        onFocus={fireFocus}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={favourite ? "Remove from favourites" : "Add to favourites"}
        style={(state) => [styles.rowFav, tv && isTvFocused(state) && styles.rowFavFocused]}
      >
        <Text style={[styles.rowFavLabel, favourite && styles.rowFavLabelOn]}>
          {favourite ? "★" : "☆"}
        </Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: webBg },
  fill: { flex: 1 },
  body: { flex: 1, flexDirection: "row", paddingBottom: 12 },
  main: { flex: 1, minWidth: 0 },
  compactBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  groupButton: {
    maxWidth: "45%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.bg2,
  },
  groupButtonOn: { backgroundColor: "rgba(255,255,255,0.16)" },
  groupButtonIcon: { color: colors.text, fontSize: 16 },
  groupButtonLabel: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "85%",
    maxWidth: 320,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: colors.bg1,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    elevation: 12,
  },
  railSearch: { marginBottom: 8 },
  railSort: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.16)",
  },
  railSortItem: { marginBottom: 0 },
  railSortValue: { color: colors.text, fontSize: 14, fontWeight: "600", marginLeft: 8 },
  railItem: {
    height: RAIL_ROW_H - 4,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  railItemActive: { borderLeftColor: colors.accent, backgroundColor: "rgba(255,255,255,0.08)" },
  railItemHovered: { backgroundColor: "rgba(255,255,255,0.05)" },
  railItemFocused: { backgroundColor: colors.focus },
  railLabel: { flex: 1, color: colors.muted, fontSize: 15, fontWeight: "600" },
  railLabelActive: { color: colors.text },
  railLabelFocused: { color: colors.bg },
  railCount: { color: colors.muted, fontSize: 13, marginLeft: 8 },
  searchWrapTv: {
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
  loadingMore: { color: colors.muted, fontSize: 13, paddingVertical: 16, textAlign: "center" },
  empty: { color: colors.muted, fontSize: 15, paddingVertical: 24 },
  starting: { color: colors.muted, marginBottom: 8, fontSize: 13, paddingLeft: 16 },
  error: { color: colors.danger, marginBottom: 8, paddingLeft: 16 },
  row: {
    height: LIST_ROW_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.bg2,
  },
  rowHovered: { backgroundColor: colors.bg1 },
  num: { color: colors.muted, width: 52, fontSize: 14 },
  numNarrow: { width: 40, fontSize: 12 },
  rowLogo: { backgroundColor: colors.bg2 },
  rowBody: { flex: 1, minWidth: 0 },
  /** The whole row height is the tap/hover target off TV. */
  rowBodyTouch: { alignSelf: "stretch", justifyContent: "center", borderRadius: 6, paddingHorizontal: 6 },
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
});
