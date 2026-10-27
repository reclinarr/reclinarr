import { type JSX, useEffect } from "react";
import { NavigationContainer, useIsFocused, useNavigation, useRoute } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { me, syncPreferences } from "@reclinarr/client";
import { StatusBar } from "expo-status-bar";
import { AppState } from "react-native";
import type { MainTabParamList, Nav, RootStackParamList } from "./src/nav";
import { attachClient, loadServerUrl, syncTvInput } from "./src/session";
import { TvInput } from "./modules/tv-input";
import { AnalyticsConsentGate, webBg } from "@reclinarr/native-ui";
import { MainTabContext } from "./src/components/Chrome";
import { BootSkeleton } from "./src/components/Skeleton";
import { ServerScreen } from "./src/screens/ServerScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { CatalogScreen } from "./src/screens/CatalogScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { DetailsScreen } from "./src/screens/DetailsScreen";
import { LiveScreen } from "./src/screens/LiveScreen";
import { DownloadsScreen } from "./src/screens/DownloadsScreen";
import { RequestsScreen } from "./src/screens/RequestsScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { PlayerScreen } from "./src/screens/PlayerScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Loading() {
  return <BootSkeleton />;
}

function BootScreen() {
  const navigation = useNavigation<Nav>();
  useEffect(() => {
    void (async () => {
      const url = await loadServerUrl();
      if (!url) {
        navigation.reset({ index: 0, routes: [{ name: "Server" }] });
        return;
      }
      attachClient(url);
      try {
        await me();
        void syncPreferences().catch((err) => console.error("[preferences] sync failed", err));
        void syncTvInput().catch((err) => console.error("[tv-input] sync failed", err));
        navigation.reset({ index: 0, routes: [{ name: "Main" }] });
      } catch {
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
      }
    })();
  }, [navigation]);
  return <Loading />;
}

function withUser(Screen: (props: { username: string }) => JSX.Element) {
  return function Wrapped() {
    const navigation = useNavigation<Nav>();
    const focused = useIsFocused();
    const route = useRoute();
    const session = useQuery({ queryKey: ["me"], queryFn: () => me() });
    useEffect(() => {
      if (session.isError) {
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
      }
    }, [navigation, session.isError]);
    if (session.isLoading || session.isError || !session.data?.user) return <Loading />;
    return (
      <AnalyticsConsentGate userId={session.data.user.id} screen={route.name.toLowerCase()} active={focused}>
        <Screen username={session.data.user.username ?? ""} />
      </AnalyticsConsentGate>
    );
  };
}

const Home = withUser(HomeScreen);
const Movies = withUser((p) => <CatalogScreen {...p} mediaType="movie" title="Movies" />);
const Series = withUser((p) => <CatalogScreen {...p} mediaType="tv" title="Series" />);
const Search = withUser(SearchScreen);
const Live = withUser(LiveScreen);
const Downloads = withUser(DownloadsScreen);
const Requests = withUser(RequestsScreen);
const Settings = withUser(SettingsScreen);
const Details = withUser(DetailsScreen);

/** Visited tabs stay mounted so switching back does not rebuild the page. */
function MainTabs() {
  return (
    <MainTabContext.Provider value>
      <Tabs.Navigator
        initialRouteName="Home"
        backBehavior="initialRoute"
        // Chrome draws the top nav inside each screen.
        tabBar={() => null}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: webBg } }}
      >
        <Tabs.Screen name="Home" component={Home} />
        <Tabs.Screen name="Movies" component={Movies} />
        <Tabs.Screen name="Series" component={Series} />
        <Tabs.Screen name="Live" component={Live} />
      </Tabs.Navigator>
    </MainTabContext.Provider>
  );
}

export function App() {
  // Favourites change inside the app; push them to the system guide when the user leaves.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") TvInput.requestSync();
    });
    return () => sub.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" hidden />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Boot"
          screenOptions={{
            headerShown: false,
            animation: "fade",
            contentStyle: { backgroundColor: webBg },
            // Keep underlying screens from holding D-pad while a modal is up.
            freezeOnBlur: true,
          }}
        >
          <Stack.Screen name="Boot" component={BootScreen} />
          <Stack.Screen name="Server" component={ServerScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="Search" component={Search} />
          <Stack.Screen name="Downloads" component={Downloads} />
          <Stack.Screen name="Requests" component={Requests} />
          <Stack.Screen name="Settings" component={Settings} />
          <Stack.Screen
            name="Details"
            component={Details}
            options={{
              // Avoid transparentModal on TV: the Home focus tree stays live underneath
              // and steals the remote even when pointerEvents/focusable are gated.
              presentation: "containedModal",
              animation: "fade",
              contentStyle: { backgroundColor: "rgba(0,0,0,0.78)" },
              gestureEnabled: false,
            }}
          />
          <Stack.Screen name="Player" component={PlayerScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>
  );
}
