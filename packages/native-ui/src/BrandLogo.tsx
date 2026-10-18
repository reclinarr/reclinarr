import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

const AMBER = "#ffb000";
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
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Reclinarr" style={[styles.logo, style]}>
      <Svg width={size} height={size} viewBox="16 16 68 68" accessible={false}>
        <Path d={MARK} fill={AMBER} fillRule="evenodd" />
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
  wordmark: { color: "#fff8eb", fontWeight: "800", letterSpacing: -0.6 },
  suffix: { color: AMBER },
});
