import { TVFocusGuideView } from "react-native";
import { useIsFocused, useRoute, type RouteProp } from "@react-navigation/native";
import { DetailsScreen as SharedDetails, TvFocusLockProvider } from "@reclinarr/native-ui";
import type { RootStackParamList } from "../nav";
import { useTvLayout } from "../layout";
import { useScreenNav } from "../useScreenNav";

export function DetailsScreen(_props: { username: string }) {
  const layout = useTvLayout();
  const nav = useScreenNav();
  const route = useRoute<RouteProp<RootStackParamList, "Details">>();
  // While fading out after Back, release the remote so the page underneath can
  // restore its focused card instead of losing it when this tree unmounts.
  const active = useIsFocused();
  return (
    <TvFocusLockProvider allow={active}>
      {/* Trap D-pad inside the modal so Home behind it cannot take focus. */}
      <TVFocusGuideView
        style={{ flex: 1 }}
        autoFocus={active}
        trapFocusUp={active}
        trapFocusDown={active}
        trapFocusLeft={active}
        trapFocusRight={active}
      >
        <SharedDetails
          nav={nav}
          params={route.params}
          focusMode="tv"
          appearance="web"
          layout={layout}
        />
      </TVFocusGuideView>
    </TvFocusLockProvider>
  );
}
