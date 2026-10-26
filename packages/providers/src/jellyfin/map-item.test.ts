import { describe, expect, it } from "vitest";
import { mapJellyfinItemToMedia } from "./map-item.js";
import type { JellyfinItem } from "./schemas.js";

const opts = { jellyfinBaseUrl: "http://jf" };

describe("mapJellyfinItemToMedia watch state", () => {
  it("carries Jellyfin's played flag onto availability", () => {
    const item = {
      Id: "m1",
      Type: "Movie",
      Name: "Heat",
      RunTimeTicks: 10_000_000 * 3000,
      UserData: { Played: true, PlaybackPositionTicks: 0 },
    } as JellyfinItem;
    const jf = mapJellyfinItemToMedia(item, opts).availability[0];
    expect(jf).toMatchObject({ provider: "jellyfin", played: true });
  });

  it("omits played when Jellyfin has no user data", () => {
    const item = { Id: "m2", Type: "Movie", Name: "Heat" } as JellyfinItem;
    const jf = mapJellyfinItemToMedia(item, opts).availability[0]!;
    expect("played" in jf).toBe(false);
  });
});
