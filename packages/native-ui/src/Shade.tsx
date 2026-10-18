import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { webGradient } from "./webStyle.js";

type ShadeKind = "billboard-vertical" | "billboard-left" | "details-bottom" | "header-top";

/**
 * Netflix-style vignettes. On web this is a CSS gradient; on native we approximate
 * with layered fills so Billboard / Details still read correctly on Google TV.
 */
export function Shade({
  kind,
  style,
}: {
  kind: ShadeKind;
  style?: StyleProp<ViewStyle>;
}) {
  if (Platform.OS === "web") {
    const image =
      kind === "billboard-vertical"
        ? "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 28%, transparent 46%, rgba(0,0,0,0.55) 72%, #000 100%)"
        : kind === "billboard-left"
          ? "linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.28) 42%, transparent 68%)"
          : kind === "details-bottom"
            ? "linear-gradient(180deg, transparent 35%, rgba(24,24,24,0.9) 72%, #181818 100%)"
            : "linear-gradient(180deg, rgba(0,0,0,0.7) 10%, transparent)";
    return <View style={[styles.fill, style, webGradient(image)]} />;
  }

  if (kind === "billboard-vertical") {
    return (
      <View style={[styles.fill, style]}>
        <View style={[styles.fill, { backgroundColor: "rgba(0,0,0,0.28)" }]} />
        <View style={styles.bottomFade} />
        <View style={styles.bottomSolid} />
      </View>
    );
  }

  if (kind === "billboard-left") {
    return (
      <View style={[styles.fill, style]}>
        <View style={styles.leftHeavy} />
        <View style={styles.leftSoft} />
      </View>
    );
  }

  if (kind === "details-bottom") {
    return (
      <View style={[styles.fill, style]}>
        <View style={styles.detailsMid} />
        <View style={styles.detailsBottom} />
      </View>
    );
  }

  // header-top
  return (
    <View style={[styles.fill, style]}>
      <View style={styles.headerBand} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, pointerEvents: "none" },
  bottomFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "28%",
    height: "32%",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  bottomSolid: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "32%",
    backgroundColor: "#000",
  },
  leftHeavy: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "42%",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  leftSoft: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "42%",
    width: "26%",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  detailsMid: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "18%",
    height: "40%",
    backgroundColor: "rgba(24,24,24,0.75)",
  },
  detailsBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "28%",
    backgroundColor: "#181818",
  },
  headerBand: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
});
