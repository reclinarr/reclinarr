import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ScreenNav } from "@reclinarr/native-ui";
import type { RootStackParamList } from "./nav";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function useScreenNav(): ScreenNav {
  const navigation = useNavigation<Nav>();
  return {
    openDetails: (params) => navigation.navigate("Details", params),
    openPlayer: (params) => navigation.navigate("Player", params),
    goBack: () => navigation.goBack(),
    resetToLogin: () => navigation.reset({ index: 0, routes: [{ name: "Login" }] }),
    resetToMain: () => navigation.reset({ index: 0, routes: [{ name: "Home" }] }),
  };
}
