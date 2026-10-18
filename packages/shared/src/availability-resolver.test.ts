import { describe, expect, it } from "vitest";
import { resolvePreferredAction } from "./availability-resolver.js";
import type { Availability } from "./media.js";

describe("resolvePreferredAction", () => {
  it("prefers Jellyfin when playable", () => {
    const availability: Availability[] = [
      {
        provider: "dispatcharr",
        available: true,
        canPlay: true,
        candidates: [],
      },
      {
        provider: "jellyfin",
        available: true,
        canPlay: true,
        itemId: "jf-1",
      },
    ];
    expect(resolvePreferredAction(availability)).toBe("PLAY_JELLYFIN");
  });

  it("prefers cache over Dispatcharr when playbackAvailable", () => {
    const availability: Availability[] = [
      {
        provider: "cache",
        available: true,
        playbackAvailable: true,
        complete: false,
        bytesDownloaded: 800,
        totalBytes: 1000,
      },
      {
        provider: "dispatcharr",
        available: true,
        canPlay: true,
        candidates: [],
      },
    ];
    expect(resolvePreferredAction(availability)).toBe("PLAY_CACHE");
  });

  it("uses PLAY_IPTV when only Dispatcharr can play", () => {
    const availability: Availability[] = [
      {
        provider: "jellyfin",
        available: false,
        canPlay: false,
      },
      {
        provider: "dispatcharr",
        available: true,
        canPlay: true,
        uuid: "abc",
        candidates: [],
      },
    ];
    expect(resolvePreferredAction(availability)).toBe("PLAY_IPTV");
  });

  it("falls back to REQUEST via Seerr", () => {
    const availability: Availability[] = [
      {
        provider: "seerr",
        requestable: true,
        requestStatus: "UNKNOWN",
      },
    ];
    expect(resolvePreferredAction(availability)).toBe("REQUEST");
  });

  it("returns NONE when nothing is actionable", () => {
    expect(resolvePreferredAction([])).toBe("NONE");
  });
});
