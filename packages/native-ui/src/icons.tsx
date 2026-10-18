import { View } from "react-native";

/** Small triangle play mark for card corners / CTAs. */
export function PlayIcon({ color, size = 14 }: { color: string; size?: number }) {
  const height = size * (14 / 24);
  const width = size * (11 / 24);
  return (
    <View
      style={{
        width: 0,
        height: 0,
        marginLeft: size * (2 / 24),
        borderLeftWidth: width,
        borderTopWidth: height / 2,
        borderBottomWidth: height / 2,
        borderLeftColor: color,
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
      }}
    />
  );
}

/** Chevron pointing down — expand hover card into the details modal. */
export function ChevronDownIcon({ color, size = 14 }: { color: string; size?: number }) {
  const half = size * 0.36;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: half,
          borderRightWidth: half,
          borderTopWidth: half * 1.15,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color,
          marginTop: size * 0.12,
        }}
      />
    </View>
  );
}

/** Down-arrow into a tray — request / download affordance. */
export function DownloadIcon({ color, size = 14 }: { color: string; size?: number }) {
  const stem = Math.max(2, Math.round(size * 0.14));
  const arrow = Math.round(size * 0.36);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: stem, height: size * 0.38, backgroundColor: color, marginBottom: -1 }} />
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: arrow,
          borderRightWidth: arrow,
          borderTopWidth: arrow,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color,
        }}
      />
      <View
        style={{
          width: size * 0.72,
          height: stem,
          backgroundColor: color,
          marginTop: size * 0.12,
          borderRadius: 1,
        }}
      />
    </View>
  );
}
