import { TVFocusGuideView } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { DetailsScreen as SharedDetails } from "@reclinarr/native-ui";
import type { RootStackParamList } from "../nav";
import { useTvLayout } from "../layout";
import { useScreenNav } from "../useScreenNav";

export function DetailsScreen(_props: { username: string }) {
  const layout = useTvLayout();
  const nav = useScreenNav();
  const route = useRoute<RouteProp<RootStackParamList, "Details">>();
  return (
    // Trap D-pad inside the transparent modal so Home behind it cannot take focus.
    <TVFocusGuideView
      style={{ flex: 1 }}
      autoFocus
      trapFocusUp
      trapFocusDown
      trapFocusLeft
      trapFocusRight
    >
      <SharedDetails
        nav={nav}
        params={route.params}
        focusMode="tv"
        appearance="web"
        layout={layout}
      />
    </TVFocusGuideView>
  );
}
