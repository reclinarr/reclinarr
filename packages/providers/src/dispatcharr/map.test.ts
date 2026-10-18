import { describe, expect, it } from "vitest";
import { durationFromSecs, mapEpisodeToMedia, mapMovieToMedia, mapSeriesToMedia, tmdbMatches } from "./map.js";

describe("dispatcharr map", () => {
  it("matches tmdb ids as strings or numbers", () => {
    expect(tmdbMatches("550", 550)).toBe(true);
    expect(tmdbMatches(550, 550)).toBe(true);
    expect(tmdbMatches("tmdb:550", 550)).toBe(true);
    expect(tmdbMatches(null, 550)).toBe(false);
  });

  it("maps duration_secs to exact seconds and rounded minutes", () => {
    expect(durationFromSecs(8400)).toEqual({ durationSeconds: 8400, runtimeMinutes: 140 });
    expect(durationFromSecs(null)).toEqual({});
    expect(durationFromSecs(0)).toEqual({});
  });

  it("maps playable movies", () => {
    const media = mapMovieToMedia(
      {
        id: 1,
        uuid: "11111111-1111-1111-1111-111111111111",
        name: "Fight Club",
        year: 1999,
        tmdb_id: "550",
        description: "Soap",
        duration_secs: 8400,
      },
      { candidates: [{ streamId: "99", label: "1080p" }] },
    );
    expect(media.preferredAction).toBe("PLAY_IPTV");
    expect(media.identity.tmdbId).toBe(550);
    expect(media.metadata.durationSeconds).toBe(8400);
    expect(media.metadata.runtimeMinutes).toBe(140);
    const da = media.availability[0];
    expect(da?.provider).toBe("dispatcharr");
    if (da?.provider === "dispatcharr") {
      expect(da.canPlay).toBe(true);
      expect(da.candidates[0]?.streamId).toBe("99");
    }
  });

  it("infers catalogueLanguage from IPTV title prefix", () => {
    const media = mapMovieToMedia({
      id: 3,
      uuid: "33333333-3333-3333-3333-333333333333",
      name: "EN - Zootopia",
      tmdb_id: "269149",
    });
    const da = media.availability[0];
    expect(da?.provider).toBe("dispatcharr");
    if (da?.provider === "dispatcharr") {
      expect(da.catalogueLanguage).toBe("en");
    }
  });

  it("reads SxxExx from the IPTV title when season fields are missing", () => {
    const media = mapEpisodeToMedia(
      {
        id: 9,
        uuid: "99999999-9999-9999-9999-999999999999",
        name: "EN - Show - S01E04 - Pilot",
        season_number: null,
        episode_number: null,
      },
      5920,
    );
    expect(media.identity.seasonNumber).toBe(1);
    expect(media.identity.episodeNumber).toBe(4);
    expect(media.metadata.title).toBe("Pilot");
    expect(media.preferredAction).toBe("PLAY_IPTV");
  });

  it("maps series as available but not directly playable", () => {
    const media = mapSeriesToMedia({
      id: 2,
      uuid: "22222222-2222-2222-2222-222222222222",
      name: "Breaking Bad",
      tmdb_id: "1396",
      episode_count: 62,
    });
    expect(media.identity.mediaType).toBe("tv");
    expect(media.preferredAction).toBe("NONE");
    const da = media.availability[0];
    if (da?.provider === "dispatcharr") {
      expect(da.available).toBe(true);
      expect(da.canPlay).toBe(false);
    }
  });
});
