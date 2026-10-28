import { Platform, useTVEventHandler } from "react-native";

const PLAY_KEYS = new Set(["select", "ok", "playPause", "play", "pause"]);
const PLAY_DEBOUNCE_MS = 280;

let lastPlayKey = "";
let lastPlayAt = 0;

export function usePlayerRemote(handler: (eventType: string) => void): void {
  useTVEventHandler((event) => {
    if (!Platform.isTV || !event?.eventType) return;
    const type = event.eventType;
    // Arrows fire down+up; skip on up so seek does not run twice.
    // Center / media keys often arrive only as key-up on Android TV.
    if (!PLAY_KEYS.has(type) && event.eventKeyAction === 1) return;
    if (PLAY_KEYS.has(type)) {
      const now = Date.now();
      if (type === lastPlayKey && now - lastPlayAt < PLAY_DEBOUNCE_MS) return;
      lastPlayKey = type;
      lastPlayAt = now;
    }
    handler(type);
  });
}
