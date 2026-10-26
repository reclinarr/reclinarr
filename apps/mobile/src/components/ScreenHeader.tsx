import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Nav } from "../nav";
import { AccentFill, BrandLogo } from "@reclinarr/native-ui";
import { colors } from "../theme";

export function ScreenHeader({
  title,
  username,
  showBack,
}: {
  title?: string;
  username?: string;
  showBack?: boolean;
}) {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
      {showBack ? (
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
      ) : (
        <BrandLogo size={26} />
      )}
      {title ? <Text style={styles.title}>{title}</Text> : <View style={styles.flex} />}
      {username != null ? (
        <Pressable
          onPress={() => navigation.navigate("Profile")}
          style={styles.profile}
          accessibilityLabel="Profile"
        >
          <AccentFill />
          <Text style={styles.profileText}>{(username || "U").slice(0, 1).toUpperCase()}</Text>
        </Pressable>
      ) : (
        <View style={styles.profileSpacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 12,
    backgroundColor: colors.bg,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  flex: { flex: 1 },
  back: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.text, fontSize: 32, lineHeight: 34, fontWeight: "300" },
  profile: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  profileSpacer: { width: 34 },
  profileText: { color: colors.text, fontWeight: "700" },
});
