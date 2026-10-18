import AsyncStorage from "@react-native-async-storage/async-storage";
import { KeyboardAvoidingView } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ServerScreen as SharedServer, loginKeyboardBehavior } from "@reclinarr/native-ui";
import type { RootStackParamList } from "../nav";
import { useScreenNav } from "../useScreenNav";

export function ServerScreen() {
  const nav = useScreenNav();
  const route = useRoute<RouteProp<RootStackParamList, "Server">>();
  const insets = useSafeAreaInsets();
  return (
    <SharedServer
      nav={nav}
      storage={AsyncStorage}
      canCancel={Boolean(route.params?.change)}
      paddingTop={insets.top + 32}
      paddingBottom={insets.bottom + 24}
      wrapper={(children) => (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={loginKeyboardBehavior}>
          {children}
        </KeyboardAvoidingView>
      )}
    />
  );
}
