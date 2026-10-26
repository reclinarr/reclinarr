import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import {
  useIsFocused,
  useNavigation,
  useNavigationState,
  useRoute,
} from "@react-navigation/native";
import { logout } from "@reclinarr/client";
import {
  AccentFill,
  BrandLogo,
  Shade,
  TvFocusLockProvider,
  TvInitialFocusSuppressProvider,
  colors,
  isTvFocused,
  useIsDemoUser,
  webBg,
} from "@reclinarr/native-ui";
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

/** Settle time before a focused tab opens, so skimming across tabs only loads the last one. */
const TAB_SKIM_DELAY_MS = 200;

/** Route opened by skimming the nav; its Chrome keeps focus on the tab instead of the page. */
let skimTarget: keyof RootStackParamList | null = null;

export function Chrome({
  username,
  children,
  overlay = false,
  scrolled = false,
  contentFocus = false,
}: {
  username?: string;
  children: ReactNode;
  /** Page content claims initial D-pad focus (hero / restored rail card), not the active tab. */
  contentFocus?: boolean;
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
  const canFocusRef = useRef(canFocus);
  canFocusRef.current = canFocus;
  const pendingNav = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One-shot like usePreferredFocusOnce, re-armed each time an overlay closes.
  const [tabFocusLanded, setTabFocusLanded] = useState(false);
  // Consume the skim flag on this visit so a later non-skim entry can still
  // prefer hero/rails. Keep local state so late-mounting content stays suppressed.
  const [skimming, setSkimming] = useState(() => skimTarget === route.name);
  useEffect(() => {
    if (canFocus) return;
    setTabFocusLanded(false);
    setSkimming(false);
    if (pendingNav.current) {
      clearTimeout(pendingNav.current);
      pendingNav.current = null;
    }
  }, [canFocus]);
  useEffect(() => {
    return () => {
      if (pendingNav.current) clearTimeout(pendingNav.current);
    };
  }, []);
  useEffect(() => {
    if (skimTarget !== route.name) return;
    setSkimming(true);
    skimTarget = null;
  }, [route.name, isFocused]);
  const retainTabFocus = skimming || skimTarget === route.name;
  const [activeTab, setActiveTab] = useState<View | null>(null);
  const layout = useTvLayout();
  const [menuOpen, setMenuOpen] = useState(false);
  const solid = !overlay || scrolled || menuOpen;
  const initial = ((username ?? "U").trim()[0] || "U").toUpperCase();
  const demo = useIsDemoUser();

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

  function clearPendingNav() {
    if (pendingNav.current) {
      clearTimeout(pendingNav.current);
      pendingNav.current = null;
    }
  }

  function openTab(name: keyof RootStackParamList, fromFocus: boolean) {
    clearPendingNav();
    if (fromFocus && !canFocusRef.current) return;
    if (route.name === name) return;
    if (fromFocus) skimTarget = name;
    navigation.navigate(name as never);
  }

  function onTabFocus(name: keyof RootStackParamList, active: boolean) {
    if (active) {
      setTabFocusLanded(true);
      return;
    }
    if (!canFocusRef.current) return;
    clearPendingNav();
    pendingNav.current = setTimeout(() => {
      pendingNav.current = null;
      openTab(name, true);
    }, TAB_SKIM_DELAY_MS);
  }

  return (
    // Details/Player keep this screen mounted underneath. Android TV still
    // routes D-pad into focusable descendants unless we tear them down.
    <TvFocusLockProvider allow={canFocus}>
      <TVFocusGuideView
        style={[styles.shell, { pointerEvents: canFocus ? "auto" : "none" }]}
      >
      {menuOpen && canFocus ? (
        <Pressable
          style={styles.dismiss}
          onPress={() => setMenuOpen(false)}
          focusable={canFocus}
        />
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
        {/* Entering the tab row (e.g. Up from the hero) lands on the current page's tab. */}
        <TVFocusGuideView
          style={styles.nav}
          destinations={activeTab ? [activeTab as never] : undefined}
        >
          {LINKS.map((link) => {
            const active = route.name === link.name;
            return (
              <Pressable
                key={link.name}
                ref={active ? setActiveTab : undefined}
                onPress={() => openTab(link.name, false)}
                focusable={canFocus}
                hasTVPreferredFocus={
                  canFocus && active && !tabFocusLanded && (retainTabFocus || !contentFocus)
                }
                onFocus={() => onTabFocus(link.name, active)}
                onBlur={clearPendingNav}
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
        </TVFocusGuideView>
        <View style={styles.tools}>
          <Pressable
            onPress={() => navigation.navigate("Search")}
            focusable={canFocus}
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
              focusable={canFocus}
              style={(s) => [styles.avatar, isTvFocused(s) && styles.avatarFocused]}
            >
              <AccentFill style={styles.avatarFill} />
              <Text style={styles.avatarText}>{initial}</Text>
            </Pressable>
            {menuOpen ? (
              <View style={styles.menu}>
                <Text style={styles.menuName}>{username || "Profile"}</Text>
                <Pressable
                  style={(s) => [styles.menuItem, isTvFocused(s) && styles.menuItemFocused]}
                  focusable={canFocus}
                  onPress={() => {
                    setMenuOpen(false);
                    navigation.navigate("Downloads");
                  }}
                >
                  {(state) => (
                    <Text
                      style={[styles.menuText, isTvFocused(state) && styles.menuTextFocused]}
                    >
                      Cache
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  style={(s) => [styles.menuItem, isTvFocused(s) && styles.menuItemFocused]}
                  focusable={canFocus}
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
                {demo ? null : (
                  <Pressable
                    style={(s) => [styles.menuItem, isTvFocused(s) && styles.menuItemFocused]}
                    focusable={canFocus}
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
                )}
                <Pressable
                  style={(s) => [styles.menuItem, isTvFocused(s) && styles.menuItemFocused]}
                  focusable={canFocus}
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
                  focusable={canFocus}
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
      <View
        style={styles.body}
        pointerEvents={canFocus ? "auto" : "none"}
        // Empty host while overlay is open — no PosterCards/Pressables to steal focus.
        focusable={false}
        importantForAccessibility={canFocus ? "auto" : "no-hide-descendants"}
      >
        <TvInitialFocusSuppressProvider suppress={retainTabFocus}>
          {canFocus ? children : null}
        </TvInitialFocusSuppressProvider>
      </View>
      </TVFocusGuideView>
    </TvFocusLockProvider>
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
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "transparent",
  },
  avatarFocused: {
    borderColor: "#fff",
    transform: [{ scale: 1.12 }],
  },
  avatarFill: { top: -3, left: -3, right: -3, bottom: -3 },
  avatarText: { color: colors.text, fontWeight: "700", fontSize: 15 },
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
