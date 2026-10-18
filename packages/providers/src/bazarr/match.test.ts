import { describe, expect, it } from "vitest";
import { matchEpisode, matchMovie, matchSeries } from "./match.js";

describe("bazarr matching", () => {
  it("matches a movie by imdb before title", () => {
    const movies = [
      { title: "Dune", year: "2021", imdbId: "tt1160419" },
      { title: "Dune", year: "1984", imdbId: "tt0087182" },
    ];
    expect(matchMovie(movies, { imdbId: "1160419", title: "Dune", year: 1984 })?.year).toBe("2021");
  });

  it("matches a series by tvdb id", () => {
    const series = [
      { title: "The Office", tvdbId: 1, imdbId: "tt0386676" },
      { title: "The Office", tvdbId: 2, imdbId: "tt0290978" },
    ];
    expect(matchSeries(series, { tvdbId: 2 })?.imdbId).toBe("tt0290978");
  });

  it("matches an episode by season and number", () => {
    const episodes = [
      { season: 1, episode: 1 },
      { season: 1, episode: 2 },
    ];
    expect(matchEpisode(episodes, 1, 2)).toEqual({ season: 1, episode: 2 });
    expect(matchEpisode(episodes, 2, 1)).toBeUndefined();
  });
});
