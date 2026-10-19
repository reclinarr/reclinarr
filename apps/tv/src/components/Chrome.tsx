import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import {
  useIsFocused,
  useNavigation,
  useNavigationState,
  useRoute,
} from "@react-navigation/native";
import { logout } from "@reclinarr/client";
import { BrandLogo, Shade, colors, isTvFocused, webBg } from "@reclinarr/native-ui";
import type { Nav, RootStackParamList } from "../nav";
import { useTvLayout } from "../layout";
import { clearSession } from "../session";

/** Routes presented over Chrome (transparent modal / player) that must own D-pad focus. */
const FOCUS_OVERLAY_ROUTES = new Set<keyof RootStackParamList>(["Details", "Player"]);

const LINKS: Array<{ name: keyof RootStackParamList; label: string }> = [
  { name: "Home", label: "Home" },
  { name: "Movies", label: "Movies" },
  { name: "Series", label: "Series" },
  { name: "Live", label: "Live TV" },
];

export function Chrome({
  username,
  children,
  overlay = false,
  scrolled = false,
}: {
  username?: string;
  children: ReactNode;
  /** Home sits under a transparent bar until the page scrolls. */
  overlay?: boolean;
  scrolled?: boolean;
}) {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const route = useRoute();
  const isFocused = useIsFocused();
  // transparentModal can leave the underlying screen "focused" for rendering —
  // also gate on the active route so Home cannot keep D-pad while Details is open.
  const overlayOpen = useNavigationState((state) => {
    const top = state?.routes[state.index];
    return Boolean(top && FOCUS_OVERLAY_ROUTES.has(top.name as keyof RootStackParamList));
  });
  const canFocus = isFocused && !overlayOpen;
  const layout = useTvLayout();
  const [menuOpen, setMenuOpen] = useState(false);
  const solid = !overlay || scrolled || menuOpen;
  const initial = ((username ?? "U").trim()[0] || "U").toUpperCase();

  async function signOut() {
    try {
      await logout();
    } catch {
      /* ignore */
    }
    await clearSession();
    await queryClient.cancelQueries();
    queryClient.clear();
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  }

  return (
    // Transparent Details keeps this screen mounted — disable the whole subtree
    // so D-pad cannot move selection on Home/Catalog behind the modal.
    <TVFocusGuideView
      style={[styles.shell, { pointerEvents: canFocus ? "auto" : "none" }]}
    >
      {menuOpen ? (
        <Pressable style={styles.dismiss} onPress={() => setMenuOpen(false)} />
      ) : null}
      <View
        style={[
          styles.header,
          { paddingHorizontal: layout.pageX, height: layout.headerH },
          solid ? styles.headerSolid : null,
        ]}
      >
        {!solid ? <Shade kind="header-top" /> : null}
        {/* Decorative on TV — keep Home as the first D-pad target, not the brand. */}
        <View style={styles.wordmarkBtn} importantForAccessibility="no-hide-descendants">
          <BrandLogo size={30} />
        </View>
        <View style={styles.nav}>
          {LINKS.map((link) => {
            const active = route.name === link.name;
            return (
              <Pressable
                key={link.name}
                onPress={() => navigation.navigate(link.name as never)}
                hasTVPreferredFocus={canFocus && active}
                style={(s) => [
                  styles.link,
                  active && styles.linkActive,
                  isTvFocused(s) && styles.linkFocused,
                ]}
              >
                {(state) => {
                  const focused = isTvFocused(state);
                  return (
                    <Text
                      style={[
                        styles.linkText,
                        active && styles.linkTextActive,
                        focused && styles.linkTextFocused,
                      ]}
                    >
                      {link.label}
                    </Text>
                  );
                }}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.tools}>
          <Pressable
            onPress={() => navigation.navigate("Search")}
            style={(s) => [styles.iconBtn, isTvFocused(s) && styles.iconFocused]}
            accessibilityLabel="Search"
          >
            {(state) => (
              <Text style={[styles.icon, isTvFocused(state) && styles.iconTextFocused]}>⌕</Text>
            )}
          </Pressable>
          <View>
            <Pressable
              onPress={() => setMenuOpen((v) => !v)}
              style={(s) => [styles.avatar, isTvFocused(s) && styles.avatarFocused]}
            >
              <Text style={styles.avatarText}>{initial}</Text>
            </Pressable>
            {menuOpen ? (
              <View style={styles.menu}>
                <Text style={styles.menuName}>{username || "Profile"}</Text>
                <Pressable
                  style={(s) => [styles.menuItem, isTvFocused(s) && styles.menuItemFocused]}
                  onPress={() => {
                    setMenuOpen(false);
                    navigation.navigate("Downloads");
                  }}
                >
                  {(state) => (
                    <Text
                      style={[styles.menuText, isTvFocused(state) && styles.menuTextFocused]}
                    >
                      Downloads
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  style={(s) => [styles.menuItem, isTvFocused(s) && styles.menuItemFocused]}
                  onPress={() => {
                    setMenuOpen(false);
                    navigation.navigate("Settings");
                  }}
                >
                  {(state) => (
                    <Text
                      style={[styles.menuText, isTvFocused(state) && styles.menuTextFocused]}
                    >
                      Settings
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  style={(s) => [styles.menuItem, isTvFocused(s) && styles.menuItemFocused]}
                  onPress={() => {
                    setMenuOpen(false);
                    navigation.navigate("Requests");
                  }}
                >
                  {(state) => (
                    <Text
                      style={[styles.menuText, isTvFocused(state) && styles.menuTextFocused]}
                    >
                      Requests
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  style={(s) => [styles.menuItem, isTvFocused(s) && styles.menuItemFocused]}
                  onPress={() => {
                    setMenuOpen(false);
                    navigation.navigate("Server", { change: true });
                  }}
                >
                  {(state) => (
                    <Text
                      style={[styles.menuText, isTvFocused(state) && styles.menuTextFocused]}
                    >
                      Change server
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  style={(s) => [styles.menuItem, isTvFocused(s) && styles.menuItemFocused]}
                  onPress={() => {
                    setMenuOpen(false);
                    void signOut();
                  }}
                >
                  {(state) => (
                    <Text
                      style={[styles.menuText, isTvFocused(state) && styles.menuTextFocused]}
                    >
                      Sign out
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </View>
      <View style={styles.body}>{children}</View>
    </TVFocusGuideView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: webBg },
  dismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 30 },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerSolid: { backgroundColor: webBg },
  wordmarkBtn: {
    marginRight: 12,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "transparent",
  },
  nav: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2 },
  /** Current route — text only, never compete with focus. */
  link: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "transparent",
  },
  linkActive: {},
  /** D-pad focus — high-contrast invert so it is unmistakable. */
  linkFocused: {
    backgroundColor: "#fff",
    borderColor: "#fff",
    transform: [{ scale: 1.06 }],
  },
  linkText: { color: "rgba(255,255,255,0.55)", fontSize: 16, fontWeight: "400" },
  linkTextActive: { color: "#fff", fontWeight: "700" },
  linkTextFocused: { color: "#000", fontWeight: "700" },
  tools: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "transparent",
  },
  iconFocused: {
    backgroundColor: "#fff",
    borderColor: "#fff",
    transform: [{ scale: 1.08 }],
  },
  icon: { color: "#fff", fontSize: 24, lineHeight: 26 },
  iconTextFocused: { color: "#000" },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 4,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "transparent",
  },
  avatarFocused: {
    borderColor: "#fff",
    transform: [{ scale: 1.12 }],
  },
  avatarText: { color: colors.bg, fontWeight: "700", fontSize: 15 },
  menu: {
    position: "absolute",
    top: 44,
    right: 0,
    minWidth: 200,
    backgroundColor: "rgba(0,0,0,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 4,
    paddingVertical: 6,
    zIndex: 50,
  },
  menuName: {
    color: "#e5e5e5",
    fontSize: 13,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
    marginBottom: 4,
  },
  menuItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: "transparent",
    marginHorizontal: 4,
    borderRadius: 4,
  },
  menuItemFocused: {
    backgroundColor: "#fff",
    borderColor: "#fff",
  },
  menuText: { color: "#fff", fontSize: 15 },
  menuTextFocused: { color: "#000", fontWeight: "700" },
  body: { flex: 1 },
});
