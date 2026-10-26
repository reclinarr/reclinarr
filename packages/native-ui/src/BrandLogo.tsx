import { useId } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { colors } from "./theme.js";

// Capital R with a play triangle cut out of its upper bowl.
const MARK =
  "M25 20H53C70 20 78 30 78 41C78 50 72 57 65 59L80 75Q84 80 78 80H67Q65 80 63 78L43 57H39V75Q39 80 34 80H25Q20 80 20 75V25Q20 20 25 20ZM42 31Q39 29 39 33V47Q39 50 42 48L57 41Q60 40 57 38Z";

export function BrandLogo({
  size = 32,
  markOnly = false,
  style,
}: {
  size?: number;
  /** Header mark without the wordmark — used on narrow web chrome. */
  markOnly?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const gradientId = `brand-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Reclinarr" style={[styles.logo, style]}>
      <Svg width={size} height={size} viewBox="16 16 68 68">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.accentFrom} />
            <Stop offset="1" stopColor={colors.accentTo} />
          </LinearGradient>
        </Defs>
        <Path d={MARK} fill={`url(#${gradientId})`} fillRule="evenodd" />
      </Svg>
      {markOnly ? null : (
        <Text accessible={false} style={[styles.wordmark, { fontSize: size * 0.95 }]}>
          eclina<Text style={styles.suffix}>rr</Text>
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0 },
  wordmark: { color: "#f7f2ff", fontWeight: "800", letterSpacing: -0.6 },
  suffix: { color: colors.accent },
});
