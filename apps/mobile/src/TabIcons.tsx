import { View, StyleSheet } from "react-native";
import { colors } from "./theme";

type Props = { focused: boolean; size?: number };

function Ink({ focused }: { focused: boolean }) {
  return focused ? colors.text : colors.muted;
}

/** Lightweight tab glyphs — no icon font dependency. */
export function HomeTabIcon({ focused, size = 22 }: Props) {
  const c = Ink({ focused });
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }}>
      <View style={[styles.homeRoof, { borderBottomColor: c, borderLeftWidth: size * 0.45, borderRightWidth: size * 0.45, borderBottomWidth: size * 0.38 }]} />
      <View style={[styles.homeBody, { width: size * 0.72, height: size * 0.48, borderColor: c }]} />
    </View>
  );
}

export function MoviesTabIcon({ focused, size = 22 }: Props) {
  const c = Ink({ focused });
  return (
    <View style={[styles.poster, { width: size * 0.72, height: size, borderColor: c }]}>
      <View style={[styles.posterBar, { backgroundColor: c }]} />
    </View>
  );
}

export function SeriesTabIcon({ focused, size = 22 }: Props) {
  const c = Ink({ focused });
  return (
    <View style={{ width: size, height: size, justifyContent: "center", gap: 3 }}>
      <View style={[styles.seriesLine, { backgroundColor: c, width: size }]} />
      <View style={[styles.seriesLine, { backgroundColor: c, width: size * 0.85 }]} />
      <View style={[styles.seriesLine, { backgroundColor: c, width: size * 0.7 }]} />
    </View>
  );
}

export function LiveTabIcon({ focused, size = 22 }: Props) {
  const c = Ink({ focused });
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={[styles.liveOuter, { width: size * 0.9, height: size * 0.9, borderColor: c }]}>
        <View style={[styles.liveDot, { backgroundColor: focused ? colors.accent : c }]} />
      </View>
    </View>
  );
}

export function SearchTabIcon({ focused, size = 22 }: Props) {
  const c = Ink({ focused });
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.searchCircle, { borderColor: c, width: size * 0.62, height: size * 0.62 }]} />
      <View
        style={[
          styles.searchHandle,
          {
            backgroundColor: c,
            width: size * 0.38,
            top: size * 0.58,
            left: size * 0.52,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  homeRoof: {
    width: 0,
    height: 0,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginBottom: -1,
  },
  homeBody: {
    borderWidth: 2,
    borderTopWidth: 0,
  },
  poster: {
    borderWidth: 2,
    borderRadius: 2,
    justifyContent: "flex-end",
    padding: 3,
  },
  posterBar: { height: 3, borderRadius: 1, opacity: 0.85 },
  seriesLine: { height: 3, borderRadius: 1 },
  liveOuter: {
    borderWidth: 2,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  searchCircle: {
    borderWidth: 2,
    borderRadius: 999,
    position: "absolute",
    top: 1,
    left: 1,
  },
  searchHandle: {
    height: 2.5,
    borderRadius: 1,
    position: "absolute",
    transform: [{ rotate: "40deg" }],
  },
});
