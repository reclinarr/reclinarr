import type { Availability, PreferredAction } from "./media.js";

export interface AvailabilityPriority {
  /** Default: jellyfin → cache → dispatcharr → seerr */
  order: Array<"jellyfin" | "cache" | "dispatcharr" | "seerr">;
}

export const DEFAULT_AVAILABILITY_PRIORITY: AvailabilityPriority = {
  order: ["jellyfin", "cache", "dispatcharr", "seerr"],
};

export function resolvePreferredAction(
  availability: Availability[],
  priority: AvailabilityPriority = DEFAULT_AVAILABILITY_PRIORITY,
): PreferredAction {
  for (const provider of priority.order) {
    const entry = availability.find((a) => a.provider === provider);
    if (!entry) continue;

    if (provider === "jellyfin" && entry.provider === "jellyfin" && entry.canPlay) {
      return "PLAY_JELLYFIN";
    }
    if (provider === "cache" && entry.provider === "cache" && entry.playbackAvailable) {
      return "PLAY_CACHE";
    }
    if (provider === "dispatcharr" && entry.provider === "dispatcharr" && entry.canPlay) {
      return "PLAY_IPTV";
    }
    if (provider === "seerr" && entry.provider === "seerr" && entry.requestable) {
      return "REQUEST";
    }
  }
  return "NONE";
}
