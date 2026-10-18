import { useNavigation } from "@react-navigation/native";
import type { ScreenNav } from "@reclinarr/native-ui";
import type { Nav } from "./nav";

export function useScreenNav(): ScreenNav {
  const navigation = useNavigation<Nav>();
  return {
    openDetails: (params) => navigation.navigate("Details", params),
    openPlayer: (params) => navigation.navigate("Player", params),
    goBack: () => navigation.goBack(),
    openServer: (opts) => navigation.navigate("Server", opts),
    resetToLogin: () => navigation.reset({ index: 0, routes: [{ name: "Login" }] }),
    resetToMain: () => navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
  };
}
