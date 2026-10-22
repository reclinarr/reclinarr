import { useId } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { webGradient } from "./webStyle.js";

type ShadeKind = "billboard-vertical" | "billboard-left" | "details-bottom" | "header-top";

type GradientStop = { offset: number; color: string; opacity: number };

/** Ramps mirror the web CSS below; `horizontal` runs left → right, otherwise top → bottom. */
const NATIVE_GRADIENTS: Record<ShadeKind, { horizontal?: boolean; stops: GradientStop[] }> = {
  "billboard-vertical": {
    stops: [
      { offset: 0, color: "#000", opacity: 0.35 },
      { offset: 0.28, color: "#000", opacity: 0 },
      { offset: 0.46, color: "#000", opacity: 0 },
      { offset: 0.72, color: "#000", opacity: 0.55 },
      { offset: 1, color: "#000", opacity: 1 },
    ],
  },
  // Heavier and wider than web: TV copy spans ~2/3 of the hero and has no text shadow.
  "billboard-left": {
    horizontal: true,
    stops: [
      { offset: 0, color: "#000", opacity: 0.85 },
      { offset: 0.45, color: "#000", opacity: 0.6 },
      { offset: 0.8, color: "#000", opacity: 0 },
    ],
  },
  "details-bottom": {
    stops: [
      { offset: 0.35, color: "#181818", opacity: 0 },
      { offset: 0.72, color: "#181818", opacity: 0.9 },
      { offset: 1, color: "#181818", opacity: 1 },
    ],
  },
  "header-top": {
    stops: [
      { offset: 0.1, color: "#000", opacity: 0.7 },
      { offset: 1, color: "#000", opacity: 0 },
    ],
  },
};

/** Netflix-style vignettes: CSS gradients on web, SVG gradients on native. */
export function Shade({
  kind,
  style,
}: {
  kind: ShadeKind;
  style?: StyleProp<ViewStyle>;
}) {
  // SVG gradient ids are document-global; useId keeps every Shade's id unique.
  const id = `shade-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
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

  const { horizontal, stops } = NATIVE_GRADIENTS[kind];
  return (
    <View style={[styles.fill, style]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient
            id={id}
            x1="0%"
            y1="0%"
            x2={horizontal ? "100%" : "0%"}
            y2={horizontal ? "0%" : "100%"}
          >
            {stops.map((s) => (
              <Stop key={s.offset} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, pointerEvents: "none" },
});
