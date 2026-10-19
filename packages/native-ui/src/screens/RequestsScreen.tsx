import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { listRequests } from "@reclinarr/client";
import { isTvFocused, tvFocusHighlight } from "../focus.js";
import { RequestListSkeleton } from "../Skeleton.js";
import { colors } from "../theme.js";
import { webBg } from "../webStyle.js";
import { Button } from "../Button.js";
import { measureAndScrollIntoView } from "../tvScroll.js";
import type { ScreenChromeProps } from "./types.js";

export function RequestsScreen({
  nav,
  header,
  focusMode = "touch",
}: Pick<ScreenChromeProps, "nav" | "header" | "focusMode">) {
  const tv = focusMode === "tv";
  const [page, setPage] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const rows = useRef<Record<number, View | null>>({});
  const { height } = useWindowDimensions();
  const pageSize = 25;
  const query = useQuery({
    queryKey: ["requests", page],
    queryFn: () => listRequests({ take: pageSize, skip: page * pageSize }),
    refetchInterval: 30_000,
  });

  return (
    <View style={styles.page}>
      {header}
      <ScrollView ref={scroll} style={styles.body} contentContainerStyle={{ paddingBottom: 48 }}
        onScroll={(event) => { offset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
        {query.isLoading ? <RequestListSkeleton rows={6} /> : null}
        {query.error ? <><Text accessibilityRole="alert" style={{ color: colors.danger }}>{query.error.message}</Text><Button label="Try again" onPress={() => void query.refetch()} showFocusRing={tv} /></> : null}
        {(query.data?.items ?? []).length === 0 && query.isSuccess ? (
          <Text style={styles.empty}>No requests yet.</Text>
        ) : null}
        {(query.data?.items ?? []).map((item) => (
          <Pressable
            key={item.id}
            ref={(view) => { rows.current[item.id] = view; }}
            onFocus={() => { if (tv) measureAndScrollIntoView(rows.current[item.id], scroll, offset, height); }}
            onPress={() => {
              if (item.tmdbId != null) {
                nav.openDetails({ type: item.mediaType, tmdbId: item.tmdbId });
              }
            }}
            style={(state) => [
              styles.row,
              state.pressed && styles.rowPressed,
              tv && isTvFocused(state) && tvFocusHighlight,
            ]}
          >
            <Text style={styles.title}>
              {item.title}
              {item.year ? ` (${item.year})` : ""}
            </Text>
            <Text style={styles.meta}>
              {item.mediaType} · {item.status}
              {item.mediaStatus ? ` · ${item.mediaStatus}` : ""}
            </Text>
          </Pressable>
        ))}
        <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
          {page > 0 ? <Button label="Previous" showFocusRing={tv} onPress={() => { setPage(page - 1); scroll.current?.scrollTo({ y: 0 }); }} /> : null}
          {(query.data?.total ?? 0) > (page + 1) * pageSize ? <Button label="Next" showFocusRing={tv} onPress={() => { setPage(page + 1); scroll.current?.scrollTo({ y: 0 }); }} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: webBg },
  body: { flex: 1, paddingHorizontal: 16 },
  empty: { color: colors.muted },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.bg2,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: 8,
  },
  rowPressed: { backgroundColor: colors.bg1 },
  title: { color: colors.text, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.muted, marginTop: 4, fontSize: 13 },
});
