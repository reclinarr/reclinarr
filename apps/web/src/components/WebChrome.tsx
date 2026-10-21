import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { logout, searchMedia } from "@reclinarr/client";
import { Artwork, BrandLogo, colors, openMedia, webGradient } from "@reclinarr/native-ui";
import type { RootStackParamList } from "../nav";
import { useWebLayout } from "../layout";
import { clearSession } from "../session";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const LINKS: Array<{ name: keyof RootStackParamList; label: string }> = [
  { name: "Home", label: "Home" },
  { name: "Movies", label: "Movies" },
  { name: "Series", label: "Series" },
  { name: "Live", label: "Live TV" },
];

export function WebChrome({
  username,
  children,
  overlay = false,
  scrolled = false,
}: {
  username?: string;
  children: ReactNode;
  /** Home and details sit under a transparent bar until the page scrolls. */
  overlay?: boolean;
  scrolled?: boolean;
}) {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const route = useRoute();
  const layout = useWebLayout();
  const [searchOpen, setSearchOpen] = useState(route.name === "Search");
  const [searchValue, setSearchValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const { narrowHeader, compactHeader, logoSize } = layout;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchValue.trim()), 400);
    return () => clearTimeout(t);
  }, [searchValue]);

  const liveSearch = useQuery({
    queryKey: ["search", "header", debounced],
    queryFn: () => searchMedia(debounced),
    enabled: searchOpen && debounced.length >= 2,
  });

  const solid = !overlay || scrolled || searchOpen || menuOpen || navOpen;
  const initial = ((username ?? "U").trim()[0] || "U").toUpperCase();
  const showPanel = panelOpen && searchOpen && searchValue.trim().length >= 2;
  const panelItems = liveSearch.data?.items.slice(0, 8) ?? [];
  const searchOpenWidth = narrowHeader ? 160 : compactHeader ? 200 : 260;

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
    <View style={styles.shell}>
      {menuOpen || navOpen || showPanel ? (
        <Pressable
          style={styles.dismiss}
          onPress={() => {
            setMenuOpen(false);
            setNavOpen(false);
            setPanelOpen(false);
          }}
        />
      ) : null}
      <View
        style={[
          styles.header,
          { paddingHorizontal: layout.pageX, height: layout.headerH, gap: narrowHeader ? 6 : 8 },
          solid ? styles.headerSolid : webGradient("linear-gradient(180deg, rgba(0,0,0,0.7) 10%, transparent)"),
        ]}
      >
        {narrowHeader ? (
          <View>
            <Pressable
              style={styles.iconBtn}
              accessibilityLabel="Browse"
              onPress={() => {
                setMenuOpen(false);
                setPanelOpen(false);
                setNavOpen((v) => !v);
              }}
            >
              <Text style={styles.icon}>☰</Text>
            </Pressable>
            {navOpen ? (
              <View style={[styles.menu, { left: 0, right: undefined }]}>
                {LINKS.map((link) => {
                  const active = route.name === link.name;
                  return (
                    <Pressable
                      key={String(link.name)}
                      style={styles.menuItem}
                      onPress={() => {
                        setNavOpen(false);
                        navigation.navigate(link.name as never);
                      }}
                    >
                      <Text style={[styles.menuText, active && styles.linkTextActive]}>{link.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}
        <Pressable accessibilityRole="link" accessibilityLabel="Reclinarr home" onPress={() => navigation.navigate("Home")}>
          <BrandLogo size={logoSize} markOnly={narrowHeader} />
        </Pressable>
        {narrowHeader ? (
          <View style={styles.navSpacer} />
        ) : (
          <View style={styles.nav}>
            {LINKS.map((link) => {
              const active = route.name === link.name;
              return (
                <Pressable
                  key={String(link.name)}
                  onPress={() => navigation.navigate(link.name as never)}
                  style={[styles.link, compactHeader && styles.linkCompact, active && styles.linkActive]}
                >
                  <Text
                    style={[
                      styles.linkText,
                      compactHeader && styles.linkTextCompact,
                      active && styles.linkTextActive,
                    ]}
                  >
                    {link.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={styles.tools}>
          <View style={[styles.search, searchOpen ? [styles.searchOpen, { width: searchOpenWidth }] : null]}>
            <Pressable
              onPress={() => {
                if (searchOpen && !searchValue.trim()) {
                  setSearchOpen(false);
                  setPanelOpen(false);
                } else {
                  setNavOpen(false);
                  setSearchOpen(true);
                  setPanelOpen(true);
                }
              }}
              style={styles.iconBtn}
              accessibilityLabel="Search"
            >
              <Text style={styles.icon}>⌕</Text>
            </Pressable>
            {searchOpen ? (
              <TextInput
                style={styles.searchInput}
                value={searchValue}
                onChangeText={(v) => {
                  setSearchValue(v);
                  setPanelOpen(true);
                }}
                placeholder="Search movies and series"
                placeholderTextColor="rgba(255,255,255,0.6)"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                returnKeyType="search"
                onSubmitEditing={() => {
                  const term = searchValue.trim();
                  if (term.length < 2) return;
                  setPanelOpen(false);
                  navigation.navigate("Search", { q: term });
                }}
              />
            ) : null}
          </View>
          <View>
            <Pressable
              style={styles.profile}
              onPress={() => {
                setNavOpen(false);
                setMenuOpen((v) => !v);
              }}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
              {narrowHeader ? null : <Text style={styles.caret}>▾</Text>}
            </Pressable>
            {menuOpen ? (
              <View style={styles.menu}>
                {username ? <Text style={styles.menuName}>{username}</Text> : null}
                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuOpen(false);
                    navigation.navigate("Downloads");
                  }}
                >
                  <Text style={styles.menuText}>Downloads</Text>
                </Pressable>
                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuOpen(false);
                    navigation.navigate("Requests");
                  }}
                >
                  <Text style={styles.menuText}>Requests</Text>
                </Pressable>
                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuOpen(false);
                    navigation.navigate("Profile");
                  }}
                >
                  <Text style={styles.menuText}>Profile</Text>
                </Pressable>
                <Pressable style={styles.menuItem} onPress={() => void signOut()}>
                  <Text style={styles.menuText}>Sign out</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
        {showPanel ? (
          <View style={styles.panel}>
            {searchValue.trim() !== debounced || (liveSearch.isFetching && !liveSearch.data) ? (
              <Text style={styles.panelStatus}>Searching…</Text>
            ) : liveSearch.isError ? (
              <Text style={[styles.panelStatus, { color: "#e87c03" }]}>{(liveSearch.error as Error).message}</Text>
            ) : panelItems.length === 0 ? (
              <Text style={styles.panelStatus}>No matches.</Text>
            ) : (
              panelItems.map((item) => {
                const key =
                  item.identity.jellyfinItemId ??
                  `${item.identity.mediaType}-${item.identity.tmdbId ?? item.metadata.title}`;
                return (
                  <Pressable
                    key={key}
                    style={styles.result}
                    onPress={() => {
                      setPanelOpen(false);
                      openMedia(
                        { navigate: (_name, params) => navigation.navigate("Details", params) },
                        item,
                      );
                    }}
                  >
                    <Artwork
                      url={item.metadata.posterUrl || item.metadata.backdropUrl}
                      maxWidth={80}
                      style={styles.resultPoster}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle} numberOfLines={1}>
                        {item.metadata.title}
                      </Text>
                      <Text style={styles.resultSub}>
                        {[item.metadata.year, item.identity.mediaType !== "other" ? item.identity.mediaType : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}
            {debounced.length >= 2 ? (
              <Pressable
                style={styles.more}
                onPress={() => {
                  setPanelOpen(false);
                  navigation.navigate("Search", { q: debounced });
                }}
              >
                <Text style={styles.menuText}>See all results for “{debounced}”</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#000" },
  dismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 30 },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerSolid: { backgroundColor: "#000" },
  nav: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2, minWidth: 0 },
  navSpacer: { flex: 1, minWidth: 8 },
  link: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 24 },
  linkCompact: { paddingHorizontal: 10, paddingVertical: 6 },
  linkActive: { backgroundColor: "rgba(255,255,255,0.2)" },
  linkText: { color: "rgba(255,255,255,0.7)", fontSize: 16, fontWeight: "400" },
  linkTextCompact: { fontSize: 14 },
  linkTextActive: { color: "#fff" },
  tools: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    height: 36,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "transparent",
    overflow: "hidden",
  },
  searchOpen: {
    borderColor: "#fff",
    backgroundColor: "rgba(0,0,0,0.75)",
  },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  icon: { color: "#fff", fontSize: 22, lineHeight: 24 },
  searchInput: { flex: 1, color: "#fff", fontSize: 15, paddingRight: 10, height: 36 },
  profile: { flexDirection: "row", alignItems: "center", gap: 6 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 4,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.bg, fontWeight: "700", fontSize: 14 },
  caret: { color: "#fff", fontSize: 12 },
  menu: {
    position: "absolute",
    top: 44,
    right: 0,
    minWidth: 180,
    backgroundColor: "rgba(0,0,0,0.92)",
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
  menuItem: { paddingHorizontal: 14, paddingVertical: 10 },
  menuText: { color: "#fff", fontSize: 14 },
  panel: {
    position: "absolute",
    top: 60,
    right: 72,
    width: 320,
    maxHeight: 420,
    backgroundColor: "rgba(20,20,20,0.98)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 4,
    zIndex: 50,
    overflow: "hidden",
  },
  panelStatus: { color: "#b3b3b3", padding: 14, fontSize: 14 },
  result: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  resultPoster: { width: 40, height: 60, borderRadius: 2, backgroundColor: "#222" },
  resultTitle: { color: "#fff", fontWeight: "600", fontSize: 14 },
  resultSub: { color: "#b3b3b3", fontSize: 12, marginTop: 2, textTransform: "capitalize" },
  more: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  body: { flex: 1 },
});
