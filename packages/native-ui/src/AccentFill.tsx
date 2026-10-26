import { useId } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { colors } from "./theme.js";

/** Violet → red diagonal fill; drop it inside any `overflow: hidden` box in place of a flat accent background. */
export function AccentFill({ style }: { style?: StyleProp<ViewStyle> }) {
  const id = `accent-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <Svg style={[styles.fill, style]} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.accentFrom} />
          <Stop offset="1" stopColor={colors.accentTo} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill },
});
