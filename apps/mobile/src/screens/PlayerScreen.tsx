import { useCallback } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import * as ScreenOrientation from "expo-screen-orientation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlayerScreen as SharedPlayer } from "@reclinarr/native-ui";
import { NativeVideoSurface } from "../NativeVideoSurface";
import type { RootStackParamList } from "../nav";

/** Restore app orientations so the UI tracks the device again after landscape playback. */
async function restoreAppOrientation() {
  // iOS can no-op unlock-to-DEFAULT right after LANDSCAPE; bounce via portrait first.
  await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
    () => null,
  );
  await ScreenOrientation.unlockAsync().catch(() => null);
}

export function PlayerScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, "Player">>();
  const insets = useSafeAreaInsets();
  const params = route.params;

  useFocusEffect(
    useCallback(() => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(
        () => null,
      );
      return () => {
        void restoreAppOrientation();
      };
    }, []),
  );

  return (
    <SharedPlayer
      params={params}
      storage={AsyncStorage}
      VideoSurface={NativeVideoSurface}
      onClose={() => navigation.goBack()}
      onReplaceParams={(next) => navigation.setParams(next as never)}
      liveZapEnabled
      userAgent={Platform.OS === "ios" ? "ReclinarrMobile/1.0" : "ExoPlayerLib/2.19.1"}
      chromeInsets={insets}
    />
  );
}
