import { Platform, useTVEventHandler } from "react-native";

export function usePlayerRemote(handler: (eventType: string) => void): void {
  useTVEventHandler((event) => {
    if (Platform.isTV && event && event.eventKeyAction !== 1) handler(event.eventType);
  });
}
