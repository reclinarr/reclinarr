import { describe, expect, it } from "vitest";
import { extractTmdbId, hasPlayableMedia, itemMatchesTmdb } from "./identity.js";
import type { JellyfinItem } from "./schemas.js";

describe("jellyfin identity", () => {
  it("matches exact TMDb ids", () => {
    const item = {
      Id: "1",
      ProviderIds: { Tmdb: "269149" },
    } as JellyfinItem;
    expect(itemMatchesTmdb(item, 269149)).toBe(true);
    expect(itemMatchesTmdb(item, 1)).toBe(false);
    expect(extractTmdbId(item)).toBe(269149);
  });

  it("allows items without TMDb", () => {
    const item = { Id: "home", Name: "Home Video", Path: "/media/home.mp4" } as JellyfinItem;
    expect(extractTmdbId(item)).toBeUndefined();
    expect(hasPlayableMedia(item)).toBe(true);
  });

  it("rejects metadata-only stubs without path", () => {
    const item = {
      Id: "stub",
      ProviderIds: { Tmdb: "1" },
      MediaSources: [{ Id: "s1" }],
    } as JellyfinItem;
    expect(hasPlayableMedia(item)).toBe(false);
  });
});
