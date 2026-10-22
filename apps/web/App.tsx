import { type JSX, useEffect, useState } from "react";
import { NavigationContainer, useIsFocused, useNavigation, useRoute } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { me } from "@reclinarr/client";
import { AnalyticsConsentGate, BootSkeleton, colors } from "@reclinarr/native-ui";
import { StatusBar } from "expo-status-bar";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./src/nav";
import { webLinking } from "./src/linking";
import { SetupWizard } from "./src/SetupWizard";
import { attachClient, ensureClient } from "./src/session";
import {
  DetailsScreen,
  DownloadsScreen,
  HomeScreen,
  LiveScreen,
  LoginScreen,
  MoviesScreen,
  PlayerScreen,
  ProfileScreen,
  RequestsScreen,
  SearchScreen,
  SeriesScreen,
} from "./src/screens";

type Nav = NativeStackNavigationProp<RootStackParamList>;

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
      const url = await ensureClient();
      // Web always talks to the host serving this app (same-origin / Metro proxy).
      attachClient(url ?? "");
      try {
        const setup = await fetch("/api/setup/status").then((r) => r.json());
        if (setup.setupRequired) {
          navigation.reset({ index: 0, routes: [{ name: "Setup" as never }] });
          return;
        }
        await me();
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
    if (session.isLoading || session.isError) return <Loading />;
    if (!session.data?.user) return <Loading />;
    return (
      <AnalyticsConsentGate userId={session.data.user.id} screen={route.name.toLowerCase()} active={focused}>
        <Screen username={session.data.user.username ?? ""} />
      </AnalyticsConsentGate>
    );
  };
}

const Home = withUser(HomeScreen);
const Movies = withUser(MoviesScreen);
const Series = withUser(SeriesScreen);
const Search = withUser(SearchScreen);
const Live = withUser(LiveScreen);
const Downloads = withUser(DownloadsScreen);
const Requests = withUser(RequestsScreen);
const Profile = withUser(ProfileScreen);
const Details = withUser((_p) => <DetailsScreen />);

/**
 * Attach the API client before any screen mounts. Deep links used to skip Boot,
 * so reload on /home (etc.) hit me() with an unconfigured client.
 */
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

export function App() {
  const clientReady = useClientReady();

  if (!clientReady) {
    return (
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Loading />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <NavigationContainer linking={webLinking} documentTitle={{ formatter: () => "Reclinarr" }}>
        <Stack.Navigator
          initialRouteName="Boot"
          screenOptions={{
            headerShown: false,
            animation: "fade",
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="Boot" component={BootScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Setup" component={SetupWizard} />
          <Stack.Screen name="Home" component={Home} />
          <Stack.Screen name="Movies" component={Movies} />
          <Stack.Screen name="Series" component={Series} />
          <Stack.Screen name="Search" component={Search} />
          <Stack.Screen name="Live" component={Live} />
          <Stack.Screen name="Downloads" component={Downloads} />
          <Stack.Screen name="Requests" component={Requests} />
          <Stack.Screen name="Profile" component={Profile} />
          <Stack.Screen
            name="Details"
            component={Details}
            options={{
              presentation: "transparentModal",
              animation: "fade",
              contentStyle: { backgroundColor: "transparent" },
            }}
          />
          <Stack.Screen name="Player" component={PlayerScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>
  );
}
