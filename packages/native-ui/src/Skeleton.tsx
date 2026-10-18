import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { NativeLayout } from "./layout.js";
import { colors } from "./theme.js";

type BlockProps = {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
  radius?: number;
};

export function SkeletonBlock({ width = "100%", height = 16, style, radius = 4 }: BlockProps) {
  const opacity = useRef(new Animated.Value(0.45)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.55);
      return;
    }
    // RN Web has no native animated module — JS driver avoids the console warning.
    const useNativeDriver = Platform.OS !== "web";
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: colors.bg2,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function CatalogSkeleton({
  layout,
  cards = 6,
}: {
  layout: NativeLayout;
  cards?: number;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: layout.cardGap,
        paddingHorizontal: layout.pageX,
      }}
      accessibilityLabel="Loading"
    >
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonBlock
          key={i}
          width={layout.cardWidth}
          height={layout.posterH}
          style={{ marginBottom: 4 }}
        />
      ))}
    </View>
  );
}

export function RailSkeleton({
  layout,
  rails = 3,
  cards = 5,
}: {
  layout: NativeLayout;
  rails?: number;
  cards?: number;
}) {
  return (
    <View accessibilityLabel="Loading">
      {Array.from({ length: rails }, (_, rail) => (
        <View key={rail} style={{ paddingLeft: layout.pageX, marginBottom: layout.railGap }}>
          <SkeletonBlock width={140} height={layout.railTitleSize} style={{ marginBottom: 8 }} />
          <View style={{ flexDirection: "row", gap: layout.cardGap, overflow: "hidden" }}>
            {Array.from({ length: cards }, (_, card) => (
              <SkeletonBlock key={card} width={layout.cardWidth} height={layout.posterH} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function HomeSkeleton({
  layout,
  rails = 2,
  cards = 4,
}: {
  layout: NativeLayout;
  rails?: number;
  cards?: number;
}) {
  return (
    <View accessibilityLabel="Loading">
      <View style={{ height: layout.heroH, marginBottom: layout.railGap, justifyContent: "flex-end" }}>
        <SkeletonBlock width="100%" height={layout.heroH} radius={0} style={StyleSheet.absoluteFill} />
        <View style={{ paddingHorizontal: layout.pageX, paddingBottom: 16, gap: 10 }}>
          <SkeletonBlock width="70%" height={28} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SkeletonBlock width={48} height={18} />
            <SkeletonBlock width={36} height={18} />
          </View>
          <SkeletonBlock width="90%" height={40} />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <SkeletonBlock width={96} height={40} />
            <SkeletonBlock width={96} height={40} />
          </View>
        </View>
      </View>
      <RailSkeleton layout={layout} rails={rails} cards={cards} />
    </View>
  );
}

export function DetailsSkeleton({ backdropH = 200 }: { backdropH?: number }) {
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Loading">
      <SkeletonBlock width="100%" height={backdropH} />
      <SkeletonBlock width="75%" height={28} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <SkeletonBlock width={48} height={16} />
        <SkeletonBlock width={40} height={16} />
        <SkeletonBlock width={56} height={16} />
      </View>
      <SkeletonBlock width="100%" height={14} />
      <SkeletonBlock width="90%" height={14} />
      <SkeletonBlock width="60%" height={14} />
      <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
        <SkeletonBlock width={120} height={44} />
        <SkeletonBlock width={120} height={44} />
      </View>
    </View>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.listRow}>
          <SkeletonBlock width={48} height={72} />
          <View style={{ flex: 1, gap: 8 }}>
            <SkeletonBlock width="70%" height={16} />
            <SkeletonBlock width="40%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ChannelListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <View style={{ gap: 10 }} accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.channelRow}>
          <SkeletonBlock width={36} height={36} radius={4} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBlock width="55%" height={14} />
            <SkeletonBlock width="75%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function BootSkeleton() {
  return (
    <View style={styles.boot} accessibilityLabel="Loading">
      <SkeletonBlock width={180} height={22} />
      <SkeletonBlock width={110} height={12} style={{ marginTop: 12 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  listRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 6,
  },
  channelRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    paddingVertical: 8,
  },
  boot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
});
