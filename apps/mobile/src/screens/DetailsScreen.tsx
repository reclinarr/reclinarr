import { useRoute, type RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DetailsScreen as SharedDetails } from "@reclinarr/native-ui";
import type { RootStackParamList } from "../nav";
import { useScreenNav } from "../useScreenNav";

export function DetailsScreen() {
  const nav = useScreenNav();
  const route = useRoute<RouteProp<RootStackParamList, "Details">>();
  const insets = useSafeAreaInsets();
  return <SharedDetails nav={nav} params={route.params} paddingTop={insets.top} />;
}
