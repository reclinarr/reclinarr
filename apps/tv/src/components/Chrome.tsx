import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
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
import type { MainTabParamList, Nav, RootStackParamList } from "../nav";
import { useTvLayout } from "../layout";
import { clearSession } from "../session";

/** True for screens rendered inside the Main tab navigator. */
export const MainTabContext = createContext(false);

type TabName = keyof MainTabParamList;

/** Routes presented over Chrome (transparent modal / player) that must own D-pad focus. */
const FOCUS_OVERLAY_ROUTES = new Set<keyof RootStackParamList>(["Details", "Player"]);

const LINKS: Array<{ name: TabName; label: string }> = [
  { name: "Home", label: "Home" },
  { name: "Movies", label: "Movies" },
  { name: "Series", label: "Series" },
  { name: "Live", label: "Live TV" },
];

/** Settle time before a focused tab opens, so skimming across tabs only loads the last one. */
const TAB_SKIM_DELAY_MS = 200;

/** Route opened by skimming the nav; its page keeps focus on the tab instead of the content. */
let skimTarget: TabName | null = null;

/** What a tab page tells the shared top bar. */
type TabPageState = {
  overlay: boolean;
  scrolled: boolean;
  /** The page has no initial focus target of its own, so the bar's tab takes focus. */
  claimTab: boolean;
};

// Module-level so a Home scroll re-renders only the bar, not the tab navigator.
const tabPages = new Map<TabName, TabPageState>();
const tabPageListeners = new Set<() => void>();

function publishTabPage(name: TabName, next: TabPageState) {
  const prev = tabPages.get(name);
  if (
    prev &&
    prev.overlay === next.overlay &&
    prev.scrolled === next.scrolled &&
    prev.claimTab === next.claimTab
  ) {
    return;
  }
  tabPages.set(name, next);
  for (const listener of tabPageListeners) listener();
}

function dropTabPage(name: TabName) {
  if (!tabPages.delete(name)) return;
  for (const listener of tabPageListeners) listener();
}

function subscribeTabPages(listener: () => void) {
  tabPageListeners.add(listener);
  return () => {
    tabPageListeners.delete(listener);
  };
}

function useTabPage(name: TabName): TabPageState | undefined {
  return useSyncExternalStore(subscribeTabPages, () => tabPages.get(name));
}

type ChromeProps = {
  username?: string;
  children: ReactNode;
  /** Page content claims initial D-pad focus (hero / restored rail card), not the active tab. */
  contentFocus?: boolean;
  /** Home sits under a transparent bar until the page scrolls. */
  overlay?: boolean;
  scrolled?: boolean;
};

export function Chrome(props: ChromeProps) {
  return useContext(MainTabContext) ? <TabPage {...props} /> : <ScreenChrome {...props} />;
}

/**
 * The Main tabs' top nav. It is drawn once above the tab pages rather than inside each
 * one, so D-pad focus stays on it while the page underneath swaps and no press is lost.
 */
export function MainTabBar({
  state,
  navigation,
  username,
}: Pick<BottomTabBarProps, "state" | "navigation"> & { username?: string }) {
  // Focus of the Main stack screen: false while Details, Player or a pushed screen covers it.
  const canFocus = useIsFocused();
  const active = state.routes[state.index]?.name as TabName;
  const page = useTabPage(active);
  const [menuOpen, setMenuOpen] = useState(false);
  // Tab whose focus already sits on the bar (opened from it, or focused there).
  const [landedFor, setLandedFor] = useState<TabName | null>(null);
  const canFocusRef = useRef(canFocus);
  canFocusRef.current = canFocus;
  const activeRef = useRef(active);
  activeRef.current = active;
  const pendingNav = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearPendingNav() {
    if (pendingNav.current) {
      clearTimeout(pendingNav.current);
      pendingNav.current = null;
    }
  }

  useEffect(() => {
    if (canFocus) return;
    // Re-arm the tab claim for when the overlay closes.
    setLandedFor(null);
    clearPendingNav();
  }, [canFocus]);
  useEffect(() => clearPendingNav, []);

  function openTab(name: TabName, fromFocus: boolean) {
    clearPendingNav();
    if (fromFocus && !canFocusRef.current) return;
    if (activeRef.current === name) return;
    if (fromFocus) skimTarget = name;
    setLandedFor(name);
    navigation.navigate(name);
  }

  function onTabFocus(name: TabName, isActive: boolean) {
    // Leaving the tabs (Back, Details) can bounce native focus onto the bar after
    // canFocus drops; counting that as landed would skip the claim on the next visit.
    if (!canFocusRef.current) return;
    if (isActive) {
      setLandedFor(name);
      return;
    }
    clearPendingNav();
    pendingNav.current = setTimeout(() => {
      pendingNav.current = null;
      openTab(name, true);
    }, TAB_SKIM_DELAY_MS);
  }

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: canFocus ? "box-none" : "none" }]}>
      <TopNav
        username={username}
        active={active}
        canFocus={canFocus}
        solid={!page?.overlay || page.scrolled || menuOpen}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        // A tab reached without the bar (Back to Home, an overlay closing) whose page
        // has no focus target of its own.
        preferActiveTab={landedFor !== active && Boolean(page?.claimTab)}
        onTabPress={(name) => openTab(name, false)}
        onTabFocus={onTabFocus}
        onTabBlur={clearPendingNav}
      />
    </View>
  );
}

/** A Main tab page. Its top nav is the shared MainTabBar. */
function TabPage({ children, overlay = false, scrolled = false, contentFocus = false }: ChromeProps) {
  const route = useRoute();
  const name = route.name as TabName;
  const canFocus = useIsFocused();
  const tabSelected = useNavigationState((state) => state?.routes[state.index]?.key === route.key);
  // A deselected tab is detached natively by react-native-screens, so it cannot take
  // D-pad focus and can stay mounted. The selected tab still tears down under Details.
  const keepMounted = !tabSelected;
  // Kept-mounted content has spent its one-shot initial focus; the bar's tab takes it instead.
  const [revisit, setRevisit] = useState(false);
  // Consume the skim flag on this visit so a later non-skim entry can still
  // prefer hero/rails. Keep local state so late-mounting content stays suppressed.
  const [skimming, setSkimming] = useState(() => skimTarget === name);
  useEffect(() => {
    if (!canFocus) setSkimming(false);
  }, [canFocus]);
  useEffect(() => {
    if (keepMounted) setRevisit(true);
    else if (!canFocus) setRevisit(false);
  }, [keepMounted, canFocus]);
  useEffect(() => {
    if (skimTarget !== name) return;
    setSkimming(true);
    skimTarget = null;
  }, [name, canFocus]);
  const claimTab = revisit || !contentFocus;
  // Before paint, so Home's first frame already has the transparent bar.
  useLayoutEffect(() => {
    publishTabPage(name, { overlay, scrolled, claimTab });
  }, [name, overlay, scrolled, claimTab]);
  // A sign-out unmounts the tabs; the next session must not inherit their state.
  useEffect(() => () => dropTabPage(name), [name]);

  return (
    // Content only exists while selected or detached, so leave focus allowed: flipping
    // it re-renders every card on both pages and stalls each tab switch on a TV CPU.
    <TvFocusLockProvider allow={canFocus || keepMounted}>
      <TVFocusGuideView style={[styles.shell, { pointerEvents: canFocus ? "auto" : "none" }]}>
        {/* Latched on once the page has been left, so it never flips on later switches
            (each flip re-renders the billboard and every rail), and content that loads
            while the page is hidden cannot pull focus. */}
        <ChromeBody
          canFocus={canFocus}
          suppressInitialFocus={revisit || skimming || skimTarget === name}
        >
          {canFocus || keepMounted ? children : null}
        </ChromeBody>
      </TVFocusGuideView>
    </TvFocusLockProvider>
  );
}

/** A stack screen outside the tabs (Search, Settings, ...) with its own top nav. */
function ScreenChrome({ username, children }: ChromeProps) {
  const navigation = useNavigation<Nav>();
  const isFocused = useIsFocused();
  // transparentModal can leave the underlying screen "focused" for rendering —
  // also gate on the active route so it cannot keep D-pad while Details is open.
  const overlayOpen = useNavigationState((state) => {
    const top = state?.routes[state.index];
    return Boolean(top && FOCUS_OVERLAY_ROUTES.has(top.name as keyof RootStackParamList));
  });
  const canFocus = isFocused && !overlayOpen;
  const canFocusRef = useRef(canFocus);
  canFocusRef.current = canFocus;
  const pendingNav = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  function clearPendingNav() {
    if (pendingNav.current) {
      clearTimeout(pendingNav.current);
      pendingNav.current = null;
    }
  }

  useEffect(() => {
    if (!canFocus) clearPendingNav();
  }, [canFocus]);
  useEffect(() => clearPendingNav, []);

  function openTab(name: TabName, fromFocus: boolean) {
    clearPendingNav();
    if (fromFocus && !canFocusRef.current) return;
    if (fromFocus) skimTarget = name;
    navigation.navigate(name as never);
  }

  function onTabFocus(name: TabName) {
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
      <TVFocusGuideView style={[styles.shell, { pointerEvents: canFocus ? "auto" : "none" }]}>
        <TopNav
          username={username}
          active={null}
          canFocus={canFocus}
          solid
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          preferActiveTab={false}
          onTabPress={(name) => openTab(name, false)}
          onTabFocus={onTabFocus}
          onTabBlur={clearPendingNav}
        />
        <ChromeBody canFocus={canFocus} suppressInitialFocus={false}>
          {canFocus ? children : null}
        </ChromeBody>
      </TVFocusGuideView>
    </TvFocusLockProvider>
  );
}

function ChromeBody({
  canFocus,
  suppressInitialFocus,
  children,
}: {
  canFocus: boolean;
  suppressInitialFocus: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={styles.body}
      pointerEvents={canFocus ? "auto" : "none"}
      // Empty host while overlay is open — no PosterCards/Pressables to steal focus.
      focusable={false}
      importantForAccessibility={canFocus ? "auto" : "no-hide-descendants"}
    >
      <TvInitialFocusSuppressProvider suppress={suppressInitialFocus}>
        {children}
      </TvInitialFocusSuppressProvider>
    </View>
  );
}

function TopNav({
  username,
  active,
  canFocus,
  solid,
  menuOpen,
  setMenuOpen,
  preferActiveTab,
  onTabPress,
  onTabFocus,
  onTabBlur,
}: {
  username?: string;
  active: TabName | null;
  canFocus: boolean;
  solid: boolean;
  menuOpen: boolean;
  setMenuOpen: (update: (open: boolean) => boolean) => void;
  preferActiveTab: boolean;
  onTabPress: (name: TabName) => void;
  onTabFocus: (name: TabName, active: boolean) => void;
  onTabBlur: () => void;
}) {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const layout = useTvLayout();
  const demo = useIsDemoUser();
  const [activeTab, setActiveTab] = useState<View | null>(null);
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

  function closeMenu() {
    setMenuOpen(() => false);
  }

  return (
    <>
      {menuOpen && canFocus ? (
        <Pressable style={styles.dismiss} onPress={closeMenu} focusable={canFocus} />
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
            const isActive = active === link.name;
            return (
              <Pressable
                key={link.name}
                ref={isActive ? setActiveTab : undefined}
                onPress={() => onTabPress(link.name)}
                focusable={canFocus}
                hasTVPreferredFocus={canFocus && isActive && preferActiveTab}
                onFocus={() => onTabFocus(link.name, isActive)}
                onBlur={onTabBlur}
                style={(s) => [
                  styles.link,
                  isActive && styles.linkActive,
                  isTvFocused(s) && styles.linkFocused,
                ]}
              >
                {(state) => {
                  const focused = isTvFocused(state);
                  return (
                    <Text
                      style={[
                        styles.linkText,
                        isActive && styles.linkTextActive,
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
                {demo ? null : (
                  <Pressable
                    style={(s) => [styles.menuItem, isTvFocused(s) && styles.menuItemFocused]}
                    focusable={canFocus}
                    onPress={() => {
                      closeMenu();
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
                )}
                <Pressable
                  style={(s) => [styles.menuItem, isTvFocused(s) && styles.menuItemFocused]}
                  focusable={canFocus}
                  onPress={() => {
                    closeMenu();
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
                      closeMenu();
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
                    closeMenu();
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
                    closeMenu();
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
    </>
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
