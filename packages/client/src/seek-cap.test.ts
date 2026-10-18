import { describe, expect, it } from "vitest";
import { maxSeekableSecondsForSource } from "./seek-cap.js";

describe("maxSeekableSecondsForSource", () => {
  it("allows full duration for Jellyfin (no download progress)", () => {
    expect(
      maxSeekableSecondsForSource({
        provider: "jellyfin",
        downloadComplete: false,
        downloadBytes: 0,
        knownDuration: 8400,
      }),
    ).toBe(8400);
  });

  it("allows full duration when Jellyfin has no known duration yet", () => {
    expect(
      maxSeekableSecondsForSource({
        provider: "jellyfin",
        downloadComplete: false,
        downloadBytes: 0,
        knownDuration: 0,
      }),
    ).toBe(Infinity);
  });

  it("caps incomplete cache downloads by bytes ratio", () => {
    expect(
      maxSeekableSecondsForSource({
        provider: "cache",
        downloadComplete: false,
        downloadBytes: 50_000_000,
        downloadTotal: 100_000_000,
        knownDuration: 3600,
      }),
    ).toBe(3600 * 0.5 - 8);
  });

  it("uses 5% headroom only for cache with unknown byte progress", () => {
    expect(
      maxSeekableSecondsForSource({
        provider: "cache",
        downloadComplete: false,
        downloadBytes: 0,
        knownDuration: 8400,
      }),
    ).toBe(Math.max(30, 8400 * 0.05));
  });

  it("unlocks full duration when cache download completes", () => {
    expect(
      maxSeekableSecondsForSource({
        provider: "cache",
        downloadComplete: true,
        downloadBytes: 100,
        downloadTotal: 100,
        knownDuration: 8400,
      }),
    ).toBe(8400);
  });
});
