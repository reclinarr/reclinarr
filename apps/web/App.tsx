import { type JSX, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { NavigationContainer, useIsFocused, useNavigation, useRoute } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { me } from "@reclinarr/client";
import { AnalyticsConsentGate, BootSkeleton, colors } from "@reclinarr/native-ui";
import { StatusBar } from "expo-status-bar";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./src/nav";
import { webLinking } from "./src/linking";
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

function SetupScreen() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const fields = [
    ["setupCode", "Setup code from the API log", true],
    ["JELLYFIN_URL", "Jellyfin address", false],
    ["SEERR_URL", "Seerr address (optional)", false],
    ["SEERR_API_KEY", "Seerr API key", true],
    ["DISPATCHARR_URL", "Dispatcharr address (optional)", false],
    ["DISPATCHARR_API_KEY", "Dispatcharr API key (or use username/password)", true],
    ["DISPATCHARR_USERNAME", "Dispatcharr username", false],
    ["DISPATCHARR_PASSWORD", "Dispatcharr password", true],
    ["BAZARR_URL", "Bazarr address (optional)", false],
    ["BAZARR_API_KEY", "Bazarr API key", true],
  ] as const;
  const save = async () => {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save setup");
      setMessage("Settings saved securely. Restart the Reclinarr server to connect your services.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save setup");
    } finally { setSaving(false); }
  };
  return <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 28, backgroundColor: "#090909" }}>
    <View style={{ width: "100%", maxWidth: 520, alignSelf: "center", gap: 14 }}>
      <Text style={{ color: "white", fontSize: 32, fontWeight: "700" }}>Set up Reclinarr</Text>
      <Text style={{ color: "#aaa", fontSize: 15, lineHeight: 22 }}>Connect Jellyfin to get started. Add your other services now or later. Secrets are stored in a private config file on this server.</Text>
      {fields.map(([key, label, secret]) => <TextInput key={key} value={values[key] ?? ""} onChangeText={(value) => setValues((v) => ({ ...v, [key]: value }))} placeholder={label} placeholderTextColor="#777" secureTextEntry={secret} autoCapitalize="none" autoCorrect={false} style={{ color: "white", backgroundColor: "#1b1b1b", borderWidth: 1, borderColor: "#333", borderRadius: 8, padding: 13 }} />)}
      {!!message && <Text style={{ color: "#ddd", lineHeight: 21 }}>{message}</Text>}
      <Pressable onPress={() => void save()} disabled={saving} style={{ backgroundColor: "#d72130", borderRadius: 8, padding: 15, alignItems: "center" }}><Text style={{ color: "white", fontWeight: "700" }}>{saving ? "Saving…" : "Save setup"}</Text></Pressable>
    </View>
  </ScrollView>;
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
          <Stack.Screen name="Setup" component={SetupScreen} />
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
