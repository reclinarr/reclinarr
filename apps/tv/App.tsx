import { type JSX, useEffect } from "react";
import { NavigationContainer, useIsFocused, useNavigation, useRoute } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { me, syncPreferences } from "@reclinarr/client";
import { StatusBar } from "expo-status-bar";
import type { Nav, RootStackParamList } from "./src/nav";
import { attachClient, loadServerUrl } from "./src/session";
import { AnalyticsConsentGate, webBg } from "@reclinarr/native-ui";
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
        navigation.reset({ index: 0, routes: [{ name: "Home" }] });
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

export function App() {
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
          <Stack.Screen name="Home" component={Home} />
          <Stack.Screen name="Movies" component={Movies} />
          <Stack.Screen name="Series" component={Series} />
          <Stack.Screen name="Search" component={Search} />
          <Stack.Screen name="Live" component={Live} />
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
