import { describe, expect, it } from "vitest";
import type { Media } from "@reclinarr/shared";
import { actionLabel, canPlayMedia, cardBadge } from "./media.js";

describe("media actions", () => {
  const media = (preferredAction: Media["preferredAction"]): Media => ({
    identity: { mediaType: "movie", tmdbId: 1 }, metadata: { title: "Movie" }, availability: [], preferredAction,
  });

  it("distinguishes on-demand playback from locally ready playback", () => {
    expect(actionLabel(media("PLAY_IPTV"))).toBe("▶ Play on demand");
    expect(cardBadge(media("PLAY_IPTV"))).toBe("On demand");
    expect(cardBadge(media("PLAY_CACHE"))).toBe("Ready to play");
    expect(cardBadge(media("PLAY_JELLYFIN"))).toBe("Ready to play");
  });

  it("never treats requested or unavailable titles as playable", () => {
    expect(canPlayMedia(media("REQUEST"))).toBe(false);
    expect(canPlayMedia(media("NONE"))).toBe(false);
    expect(canPlayMedia(media("PLAY_IPTV"))).toBe(true);
  });
});
