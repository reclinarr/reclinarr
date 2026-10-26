import { useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Acquisition } from "@reclinarr/shared";
import {
  cancelAcquisition,
  formatCacheTtlRemaining,
  listAcquisitions,
  mediaByJellyfin,
  mediaByTmdb,
} from "@reclinarr/client";
import { Artwork } from "../Artwork.js";
import { Button } from "../Button.js";
import { isTvFocused, tvFocusHighlight } from "../focus.js";
import { DownloadListSkeleton } from "../Skeleton.js";
import { AccentFill } from "../AccentFill.js";
import { colors } from "../theme.js";
import { measureAndScrollIntoView } from "../tvScroll.js";
import { webBg } from "../webStyle.js";
import type { ScreenChromeProps } from "./types.js";

function DownloadRow({ item, nav, tv, onFocus }: {
  item: Acquisition;
  nav: ScreenChromeProps["nav"];
  tv: boolean;
  onFocus: (view: View | null) => void;
}) {
  const queryClient = useQueryClient();
  const row = useRef<View>(null);
  const identity = item.identity;
  const type = identity.mediaType === "movie" ? "movie" : "tv";
  const details = useQuery({
    queryKey: identity.tmdbId ? ["media", type, identity.tmdbId] : ["media", "jellyfin", identity.jellyfinItemId],
    queryFn: () => identity.tmdbId ? mediaByTmdb(type, identity.tmdbId) : mediaByJellyfin(identity.jellyfinItemId!),
    enabled: Boolean(identity.tmdbId || identity.jellyfinItemId),
    staleTime: 60_000,
  });
  const action = useMutation({
    mutationFn: () => cancelAcquisition(item.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["acquisitions"] });
      void queryClient.invalidateQueries({ queryKey: ["media"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
    },
  });
  const metadata = details.data?.media.metadata;
  const title = metadata?.title ?? (details.isPending ? "Loading title…" : "Title unavailable");
  const episode = identity.mediaType === "episode" ? ` · S${identity.seasonNumber ?? 0}E${identity.episodeNumber ?? 0}` : "";
  const active = ["queued", "downloading", "playable"].includes(item.state);
  const percent = item.state === "completed" ? 100
    : item.totalBytes && item.totalBytes > 0
      ? Math.min(99, Math.round(item.bytesDownloaded / item.totalBytes * 100)) : null;
  const ttl = formatCacheTtlRemaining(item.cacheExpiresAt);
  const status = item.state === "playable" ? "Caching · Ready to play"
    : item.state === "completed" ? "Ready to play"
      : item.state === "downloading" ? "Caching"
        : item.state.charAt(0).toUpperCase() + item.state.slice(1);

  return (
    <View>
      <Pressable
        ref={row}
        onFocus={() => onFocus(row.current)}
        accessibilityRole="button"
        accessibilityLabel={`${title}${episode}, ${status}`}
        onPress={() => {
          if (identity.tmdbId) nav.openDetails({
            type, tmdbId: identity.tmdbId,
            ...(identity.mediaType === "episode" ? {
              focusEpisode: { seasonNumber: identity.seasonNumber ?? 0, episodeNumber: identity.episodeNumber ?? 0 },
            } : {}),
          });
          else if (identity.jellyfinItemId) nav.openDetails({ jellyfinItemId: identity.jellyfinItemId });
        }}
        style={(state) => [styles.row, state.pressed && styles.rowPressed, tv && isTvFocused(state) && tvFocusHighlight]}
      >
        <Artwork url={metadata?.backdropUrl || metadata?.posterUrl} maxWidth={240} style={styles.artwork} />
        <View style={styles.rowBody}>
          <Text style={styles.title} numberOfLines={2}>{title}{episode}</Text>
          <Text style={styles.meta}>{status}{active && percent != null ? ` · ${percent}%` : ""}{ttl ? ` · ${ttl}` : ""}</Text>
          {active ? (
            <>
              <Text style={styles.meta}>{Math.round(item.bytesDownloaded / 1_000_000)} MB{item.totalBytes ? ` of ${Math.round(item.totalBytes / 1_000_000)} MB` : ""}</Text>
              {percent != null ? <View style={styles.progress}><View style={[styles.progressFill, { width: `${percent}%` }]}><AccentFill /></View></View> : null}
            </>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        {active ? (
          <Button label="Stop caching" variant="ghost" onPress={() => action.mutate()} disabled={action.isPending} showFocusRing={tv} />
        ) : null}
      </View>
      {action.error ? <Text accessibilityRole="alert" style={styles.error}>{action.error.message}</Text> : null}
    </View>
  );
}

export function DownloadsScreen({ nav, header, focusMode = "touch" }: Pick<ScreenChromeProps, "nav" | "header" | "focusMode">) {
  const tv = focusMode === "tv";
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const { height } = useWindowDimensions();
  const query = useQuery({
    queryKey: ["acquisitions"],
    queryFn: () => listAcquisitions(),
    refetchInterval: (result) => (result.state.data?.items ?? []).some((item) => ["queued", "downloading", "playable"].includes(item.state)) ? 2000 : false,
  });
  return (
    <View style={styles.page}>
      {header}
      <ScrollView ref={scroll} style={styles.body} contentContainerStyle={styles.content}
        onScroll={(event) => { offset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
        {query.isLoading ? <DownloadListSkeleton rows={5} /> : null}
        {query.error ? <><Text accessibilityRole="alert" style={styles.error}>{query.error.message}</Text><Button label="Try again" onPress={() => void query.refetch()} showFocusRing={tv} /></> : null}
        {query.isSuccess && !query.data.items.length ? <Text style={styles.empty}>Nothing cached yet.</Text> : null}
        {(query.data?.items ?? []).map((item) => (
          <DownloadRow key={item.id} item={item} nav={nav} tv={tv}
            onFocus={(view) => { if (tv) measureAndScrollIntoView(view, scroll, offset, height); }} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: webBg },
  body: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 48 },
  empty: { color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 8, gap: 12, borderWidth: 2, borderColor: "transparent", borderRadius: 8 },
  rowPressed: { backgroundColor: colors.bg1 },
  artwork: { width: 96, height: 54, borderRadius: 4 },
  rowBody: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.muted, marginTop: 4, fontSize: 13 },
  actions: { flexDirection: "row", paddingHorizontal: 8, paddingBottom: 8 },
  progress: { height: 3, marginTop: 8, backgroundColor: colors.bg2 },
  progressFill: { height: 3, backgroundColor: colors.accent, overflow: "hidden" },
  error: { color: colors.danger, marginVertical: 8 },
});
