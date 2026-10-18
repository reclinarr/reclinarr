import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { PlayerScreen as SharedPlayer } from "@reclinarr/native-ui";
import { NativeVideoSurface } from "../NativeVideoSurface";
import type { RootStackParamList } from "../nav";

export function PlayerScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, "Player">>();
  return (
    <SharedPlayer
      params={route.params}
      storage={AsyncStorage}
      VideoSurface={NativeVideoSurface}
      onClose={() => navigation.goBack()}
      onReplaceParams={(next) => navigation.setParams(next as never)}
      liveZapEnabled
      userAgent="ExoPlayerLib/2.19.1"
    />
  );
}
