import { useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const [searchFocused, setSearchFocused] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<LiveSort>("number");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const searchInputRef = useRef<TextInput>(null);
  const filterScrollRef = useRef<ScrollView>(null);
  const channelListRef = useRef<ScrollView>(null);
  const channelScrollY = useRef(0);
  const listRowH = useRef(64);
  const cardRowH = useRef(180);
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
  const channels = useQuery({
    queryKey: ["live", "channels", groupId, search, page, sort],
    queryFn: () =>
      liveChannels({
        groupId: groupId && groupId !== "favourites" ? groupId : undefined,
        favouritesOnly: groupId === "favourites",
        search: search.trim() || undefined,
        page,
        pageSize: 60,
        sort,
      }),
  });

  const channelUuids = useMemo(
    () => (channels.data?.items ?? []).map((c) => c.uuid),
    [channels.data?.items],
  );

  const nowNext = useQuery({
    queryKey: ["live", "now", channelUuids.join(",")],
    queryFn: () => liveNow(channelUuids),
    enabled: channelUuids.length > 0,
    refetchInterval: 60_000,
  });

  const nowMap = useMemo(() => {
    const map = new Map<string, LiveNowNext>();
    for (const item of nowNext.data?.items ?? []) map.set(item.channelUuid, item);
    return map;
  }, [nowNext.data?.items]);

  const playMutation = useMutation({
    mutationFn: (uuid: string) => playLiveChannel(uuid, { hls: preferHls }),
    onSuccess: (data, uuid) => {
      trackFeature("live_tune");
      const list = (channels.data?.items ?? []).map((c) => ({
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["live", "channels"] }),
  });

  const totalPages = Math.max(1, Math.ceil((channels.data?.total ?? 0) / 60));
  const favourites = channels.data?.favourites ?? [];
  const items = channels.data?.items ?? [];

  const cycleSort = () => {
    const idx = SORT_CYCLE.indexOf(sort);
    setSort(SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]!);
    setPage(1);
  };

  const setFilter = (next: string | "favourites" | "") => {
    setGroupId(next);
    setPage(1);
  };

  /** Keep the focused Live TV row/card inside the list viewport (D-pad does not auto-scroll). */
  const scrollChannelIntoView = (index: number, target?: View | null) => {
    if (!tv) return;
    const list = channelListRef.current;
    if (!list) return;

    const applyDelta = (delta: number) => {
      if (Math.abs(delta) < 4) return;
      const next = Math.max(0, channelScrollY.current + delta);
      channelScrollY.current = next;
      list.scrollTo({ y: next, animated: true });
    };

    if (target) {
      target.measureInWindow((_x, y, _w, h) => {
        if (h <= 0) return;
        // ScrollView instances expose NativeMethods; RN's ScrollView type omits them.
        (list as unknown as View).measureInWindow((_lx, ly, _lw, lh) => {
          if (lh <= 0) return;
          const pad = 16;
          const top = ly + pad;
          const bottom = ly + lh - pad;
          if (y + h > bottom) applyDelta(y + h - bottom);
          else if (y < top) applyDelta(-(top - y));
        });
      });
      return;
    }

    if (viewMode === "card") {
      const row = Math.floor(index / 2);
      list.scrollTo({
        y: Math.max(0, row * cardRowH.current - cardRowH.current),
        animated: true,
      });
    } else {
      list.scrollTo({
        y: Math.max(0, index * listRowH.current - listRowH.current * 2),
        animated: true,
      });
    }
  };

  const renderChannel = (item: LiveChannel, index: number) => {
    const favourite = favourites.includes(item.uuid);
    const now = nowMap.get(item.uuid);
    const onPlay = () => playMutation.mutate(item.uuid);
    const onFocus = (target?: View | null) => scrollChannelIntoView(index, target);
    if (viewMode === "card") {
      return (
        <ChannelCard
          channel={item}
          now={now}
          favourite={favourite}
          playEnabled={!playMutation.isPending}
          showFocusRing={tv}
          onPlay={onPlay}
          onFav={() => favMutation.mutate(item.uuid)}
          onFocus={onFocus}
          onRowLayout={(h) => {
            if (h > 40) cardRowH.current = h + 10;
          }}
        />
      );
    }
    return (
      <ChannelRow
        channel={item}
        now={now}
        favourite={favourite}
        playEnabled={!playMutation.isPending}
        showFocusRing={tv}
        onPlay={onPlay}
        onFav={() => favMutation.mutate(item.uuid)}
        onFocus={onFocus}
        onRowLayout={(h) => {
          if (h > 40) listRowH.current = h;
        }}
      />
    );
  };

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
            onChangeText={(v) => {
              setSearch(v);
              setPage(1);
            }}
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
              onPress={() => setFilter(item.id as string | "favourites" | "")}
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

      <ScrollView
        ref={channelListRef}
        style={[styles.channelListBox, { height: channelListH }]}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          channelScrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        {channels.isError ? (
          <Text style={styles.error}>{(channels.error as Error).message}</Text>
        ) : null}
        {channels.isPending && items.length === 0 ? (
          <ChannelListSkeleton rows={8} />
        ) : null}
        {items.length === 0 && !channels.isPending ? (
          <Text style={styles.empty}>No channels in this group.</Text>
        ) : null}
        {viewMode === "card" ? (
          <View style={styles.cardGrid}>
            {items.map((item, index) => (
              <View key={item.uuid} style={styles.cardCell}>
                {renderChannel(item, index)}
              </View>
            ))}
          </View>
        ) : (
          items.map((item, index) => (
            <View key={item.uuid}>{renderChannel(item, index)}</View>
          ))
        )}
        <View style={styles.pager}>
          <Button
            label="Prev"
            variant="ghost"
            onPress={() => setPage((p) => Math.max(1, p - 1))}
            showFocusRing={tv}
          />
          <Text style={styles.pageLabel}>
            {page} / {totalPages}
          </Text>
          <Button
            label="Next"
            variant="ghost"
            onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
            showFocusRing={tv}
          />
        </View>
      </ScrollView>
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

function ChannelRow({
  channel,
  now,
  favourite,
  playEnabled,
  showFocusRing = false,
  onPlay,
  onFav,
  onFocus,
  onRowLayout,
}: {
  channel: LiveChannel;
  now?: LiveNowNext;
  favourite: boolean;
  playEnabled: boolean;
  showFocusRing?: boolean;
  onPlay: () => void;
  onFav: () => void;
  onFocus?: (row: View | null) => void;
  onRowLayout?: (height: number) => void;
}) {
  const rowRef = useRef<View>(null);
  const fireFocus = () => onFocus?.(rowRef.current);
  return (
    <View
      ref={rowRef}
      style={styles.row}
      onLayout={(e) => onRowLayout?.(e.nativeEvent.layout.height)}
    >
      <Text style={styles.num} numberOfLines={1} adjustsFontSizeToFit>{channel.number ?? ""}</Text>
      <ChannelLogo channel={channel} size={40} style={styles.rowLogo} />
      <Pressable
        onPress={onPlay}
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
        onPress={onFav}
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
        onPress={onPlay}
        onFocus={fireFocus}
        compact
        showFocusRing={showFocusRing}
      />
    </View>
  );
}

function ChannelCard({
  channel,
  now,
  favourite,
  playEnabled,
  showFocusRing = false,
  onPlay,
  onFav,
  onFocus,
  onRowLayout,
}: {
  channel: LiveChannel;
  now?: LiveNowNext;
  favourite: boolean;
  playEnabled: boolean;
  showFocusRing?: boolean;
  onPlay: () => void;
  onFav: () => void;
  onFocus?: (row: View | null) => void;
  onRowLayout?: (height: number) => void;
}) {
  const cardRef = useRef<View>(null);
  const fireFocus = () => onFocus?.(cardRef.current);
  return (
    <Pressable
      ref={cardRef}
      onPress={onPlay}
      onFocus={fireFocus}
      onLayout={(e) => onRowLayout?.(e.nativeEvent.layout.height)}
      disabled={!playEnabled}
      style={(state) => [
        styles.card,
        showFocusRing && isTvFocused(state) && styles.cardFocused,
      ]}
    >
      <View style={styles.cardTop}>
        <ChannelLogo channel={channel} size={56} />
        <Pressable
          onPress={onFav}
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
        onPress={onPlay}
        onFocus={fireFocus}
        showFocusRing={showFocusRing}
      />
    </Pressable>
  );
}

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
  cardGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cardCell: { width: "48%", flexGrow: 1 },
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
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
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
    backgroundColor: colors.bg1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
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
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 10,
  },
  pageLabel: { color: colors.text, fontSize: 15 },
});
