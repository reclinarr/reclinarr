import { type JSX, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { NavigationContainer, useIsFocused, useNavigation, useRoute } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { me } from "@reclinarr/client";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import type { MainTabParamList, Nav, RootStackParamList } from "./src/nav";
import { attachClient, ensureClient, loadServerUrl } from "./src/session";
import { AnalyticsConsentGate } from "@reclinarr/native-ui";
import { colors } from "./src/theme";
import {
  HomeTabIcon,
  LiveTabIcon,
  MoviesTabIcon,
  SearchTabIcon,
  SeriesTabIcon,
} from "./src/TabIcons";
import { ServerScreen } from "./src/screens/ServerScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { CatalogScreen } from "./src/screens/CatalogScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { DetailsScreen } from "./src/screens/DetailsScreen";
import { LiveScreen } from "./src/screens/LiveScreen";
import { DownloadsScreen } from "./src/screens/DownloadsScreen";
import { RequestsScreen } from "./src/screens/RequestsScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { PlayerScreen } from "./src/screens/PlayerScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.boot}>
      <Text style={styles.bootWordmark}>RECLINARR</Text>
      <Text style={styles.bootLabel}>{label}</Text>
    </View>
  );
}

function BootScreen() {
  const navigation = useNavigation<Nav>();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const url = await loadServerUrl();
        if (cancelled) return;
        if (!url) {
          navigation.reset({ index: 0, routes: [{ name: "Server" }] });
          return;
        }
        attachClient(url);
        try {
          await me();
          if (!cancelled) navigation.reset({ index: 0, routes: [{ name: "Main" }] });
        } catch {
          if (!cancelled) navigation.reset({ index: 0, routes: [{ name: "Login" }] });
        }
      } catch {
        if (!cancelled) navigation.reset({ index: 0, routes: [{ name: "Server" }] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);
  return <Loading label="Starting…" />;
}

function withUser(Screen: (props: { username: string }) => JSX.Element) {
  return function Wrapped() {
    const navigation = useNavigation<Nav>();
    const focused = useIsFocused();
    const route = useRoute();
    const session = useQuery({
      queryKey: ["me"],
      queryFn: async () => {
        // Metro HMR clears the in-memory client while React Query keeps cached me().
        await ensureClient();
        return me();
      },
    });
    useEffect(() => {
      // Only bounce the focused screen — a refetch 401 under Player must not wipe the stack.
      if (focused && session.isError && !session.data && !session.isFetching) {
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
      }
    }, [focused, navigation, session.isError, session.data, session.isFetching]);
    useEffect(() => {
      if (focused) void ensureClient().catch(() => null);
    }, [focused]);
    if (!session.data && (session.isLoading || session.isError)) return <Loading />;
    if (!session.data) return <Loading />;
    return (
      <AnalyticsConsentGate userId={session.data.user.id} screen={route.name.toLowerCase()} active={focused}>
        <Screen username={session.data.user.username ?? ""} />
      </AnalyticsConsentGate>
    );
  };
}

/** Metro reloads clear the in-memory client; re-attach before screens call me()/login(). */
function useClientReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void ensureClient()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

const Home = withUser(HomeScreen);
const Movies = withUser((p) => <CatalogScreen {...p} mediaType="movie" title="Movies" />);
const Series = withUser((p) => <CatalogScreen {...p} mediaType="tv" title="Series" />);
const Search = withUser(SearchScreen);
const Live = withUser(LiveScreen);
const Downloads = withUser(DownloadsScreen);
const Requests = withUser(RequestsScreen);
const Details = withUser((_p) => <DetailsScreen />);

function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.muted,
        tabBarShowLabel: true,
        tabBarLabelStyle: styles.tabLabel,
        tabBarStyle: [
          styles.tabBar,
          {
            height: 52 + bottom,
            paddingBottom: bottom,
            paddingTop: 8,
          },
        ],
      }}
    >
      <Tab.Screen
        name="Home"
        component={Home}
        options={{
          tabBarLabel: "Home",
          tabBarIcon: ({ focused }) => <HomeTabIcon focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Movies"
        component={Movies}
        options={{
          tabBarLabel: "Movies",
          tabBarIcon: ({ focused }) => <MoviesTabIcon focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Series"
        component={Series}
        options={{
          tabBarLabel: "Series",
          tabBarIcon: ({ focused }) => <SeriesTabIcon focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Live"
        component={Live}
        options={{
          tabBarLabel: "Live",
          tabBarIcon: ({ focused }) => <LiveTabIcon focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Search"
        component={Search}
        options={{
          tabBarLabel: "Search",
          tabBarIcon: ({ focused }) => <SearchTabIcon focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

export function App() {
  const clientReady = useClientReady();

  if (!clientReady) {
    return (
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Loading label="Starting…" />
        </QueryClientProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Boot"
            screenOptions={{
              headerShown: false,
              // Netflix-style: push/pop slides horizontally (not cross-fade).
              animation: "slide_from_right",
              animationDuration: 280,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="Boot" component={BootScreen} options={{ animation: "fade" }} />
            <Stack.Screen name="Server" component={ServerScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="Details" component={Details} />
            <Stack.Screen name="Downloads" component={Downloads} />
            <Stack.Screen name="Requests" component={Requests} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Player" component={PlayerScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  bootWordmark: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 4,
  },
  bootLabel: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 12,
    marginBottom: 24,
  },
  tabBar: {
    backgroundColor: colors.bg1,
    borderTopColor: colors.bg2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabLabel: { fontSize: 11, fontWeight: "600" },
});
