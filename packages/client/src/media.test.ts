import { describe, expect, it } from "vitest";
import type { Media } from "@reclinarr/shared";
import { actionLabel, canPlayMedia, cardBadge, primaryAction } from "./media.js";

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

  it("walks the primary action from Request through download progress", () => {
    const withSeerr = (seerr: Partial<Extract<Media["availability"][number], { provider: "seerr" }>>): Media => ({
      ...media("NONE"),
      availability: [{ provider: "seerr", requestable: false, ...seerr }],
    });
    expect(primaryAction(media("PLAY_IPTV"))).toMatchObject({ kind: "play", label: "Play on demand" });
    expect(primaryAction(media("REQUEST"))).toMatchObject({ kind: "request", label: "Request" });
    expect(primaryAction(withSeerr({ requestStatus: "PENDING", mediaStatus: "PENDING" }))).toMatchObject({
      kind: "requested",
      label: "Requested",
      progress: null,
    });
    expect(primaryAction(withSeerr({ requestStatus: "APPROVED", mediaStatus: "PROCESSING" }))).toMatchObject({
      kind: "requested",
      label: "Queued",
    });
    expect(
      primaryAction(
        withSeerr({ mediaStatus: "PROCESSING", downloadProgress: { totalBytes: 1000, bytesLeft: 580 } }),
      ),
    ).toMatchObject({ kind: "downloading", label: "Downloading 42%", progress: 42 });
  });

  it("never treats requested or unavailable titles as playable", () => {
    expect(canPlayMedia(media("REQUEST"))).toBe(false);
    expect(canPlayMedia(media("NONE"))).toBe(false);
    expect(canPlayMedia(media("PLAY_IPTV"))).toBe(true);
  });
});
