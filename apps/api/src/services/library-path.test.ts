import { describe, expect, it } from "vitest";
import { buildLibraryRelativePath, sanitizeLibraryName } from "./library-path.js";

describe("library-path", () => {
  it("sanitizes illegal characters", () => {
    expect(sanitizeLibraryName('Foo/Bar: "Baz"')).toBe("FooBar Baz");
  });

  it("builds movie folder layout", () => {
    const path = buildLibraryRelativePath(
      { mediaType: "movie", tmdbId: 123 },
      { title: "Inception", year: 2010 },
    );
    expect(path.replace(/\\/g, "/")).toBe(
      "library/movies/Inception (2010)/Inception (2010).mkv",
    );
  });

  it("builds episode season layout", () => {
    const path = buildLibraryRelativePath(
      { mediaType: "episode", tmdbId: 1396, seasonNumber: 1, episodeNumber: 2 },
      {
        title: "Breaking Bad",
        seriesTitle: "Breaking Bad",
        episodeTitle: "Cats in the Bag",
      },
    );
    expect(path.replace(/\\/g, "/")).toBe(
      "library/series/Breaking Bad/Season 01/Breaking Bad - S01E02 - Cats in the Bag.mkv",
    );
  });
});
