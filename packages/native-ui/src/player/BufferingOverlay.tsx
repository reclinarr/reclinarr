import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme.js";

/** Shared waiting state for web, iOS and Android TV video surfaces. */
export function BufferingOverlay({
  visible,
  progressPercent,
}: {
  visible: boolean;
  /** 0–100 when known (download or buffered range); omit for indeterminate. */
  progressPercent?: number | null;
}) {
  if (!visible) return null;

  const hasPct =
    progressPercent != null && Number.isFinite(progressPercent) && progressPercent >= 0;
  const pct = hasPct
    ? Math.max(0, Math.min(99, Math.round(progressPercent as number)))
    : null;
  return (
    <View style={styles.box}>
      {pct == null ? <ActivityIndicator size="large" color="#fff" /> : null}
      <Text style={styles.label}>{pct != null ? `Buffering… ${pct}%` : "Buffering…"}</Text>
      {pct != null ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    zIndex: 8,
    pointerEvents: "none",
  },
  label: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  track: {
    width: 200,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
});
