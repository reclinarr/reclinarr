import { type JSX, useEffect } from "react";
import { NavigationContainer, useNavigation } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { me } from "@reclinarr/client";
import { StatusBar } from "expo-status-bar";
import type { Nav, RootStackParamList } from "./src/nav";
import { attachClient, loadServerUrl } from "./src/session";
import { webBg } from "@reclinarr/native-ui";
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
    const session = useQuery({ queryKey: ["me"], queryFn: () => me() });
    useEffect(() => {
      if (session.isError) {
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
      }
    }, [navigation, session.isError]);
    if (session.isLoading || session.isError) return <Loading />;
    return <Screen username={session.data?.user.username ?? ""} />;
  };
}

const Home = withUser(HomeScreen);
const Movies = withUser((p) => <CatalogScreen {...p} mediaType="movie" title="Movies" />);
const Series = withUser((p) => <CatalogScreen {...p} mediaType="tv" title="Series" />);
const Search = withUser(SearchScreen);
const Live = withUser(LiveScreen);
const Downloads = withUser(DownloadsScreen);
const Requests = withUser(RequestsScreen);
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
