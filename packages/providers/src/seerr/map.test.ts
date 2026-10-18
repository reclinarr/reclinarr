import { describe, expect, it } from "vitest";
import {
  mapMediaInfoToRequestAvailability,
  mapMovieDetailsToMedia,
  mapSearchResultToMedia,
  mapSeerrEpisodeToMedia,
  mapTvDetailsToMedia,
} from "./map.js";
import { SeerrMediaStatus, SeerrRequestStatus } from "./schemas.js";

describe("seerr map", () => {
  it("marks unknown media as requestable", () => {
    const avail = mapMediaInfoToRequestAvailability(null);
    expect(avail.requestable).toBe(true);
    expect(avail.mediaStatus).toBe("UNKNOWN");
  });

  it("does not request already available media", () => {
    const avail = mapMediaInfoToRequestAvailability({
      status: SeerrMediaStatus.AVAILABLE,
    });
    expect(avail.requestable).toBe(false);
    expect(avail.mediaStatus).toBe("AVAILABLE");
  });

  it("does not request pending requests", () => {
    const avail = mapMediaInfoToRequestAvailability({
      status: SeerrMediaStatus.UNKNOWN,
      requests: [{ status: SeerrRequestStatus.PENDING }],
    });
    expect(avail.requestable).toBe(false);
    expect(avail.requestStatus).toBe("PENDING");
  });

  it("maps movie search results", () => {
    const media = mapSearchResultToMedia({
      id: 550,
      mediaType: "movie",
      title: "Fight Club",
      releaseDate: "1999-10-15",
      overview: "An insomniac…",
      posterPath: "/poster.jpg",
      backdropPath: "/back.jpg",
    });
    expect(media?.identity.tmdbId).toBe(550);
    expect(media?.metadata.year).toBe(1999);
    expect(media?.metadata.posterUrl).toContain("/w500/poster.jpg");
    expect(media?.preferredAction).toBe("REQUEST");
  });

  it("maps a TMDb episode with still and overview", () => {
    const media = mapSeerrEpisodeToMedia(
      {
        name: "Pilot",
        episodeNumber: 1,
        seasonNumber: 1,
        overview: "The first one.",
        stillPath: "/still.jpg",
        runtime: 42,
        airDate: "2011-04-17",
      },
      5920,
      1,
    );
    expect(media.identity).toMatchObject({
      tmdbId: 5920,
      mediaType: "episode",
      seasonNumber: 1,
      episodeNumber: 1,
    });
    expect(media.metadata.stillUrl).toContain("/w300/still.jpg");
    expect(
      mapSeerrEpisodeToMedia(
        {
          episodeNumber: 2,
          stillPath: "https://image.tmdb.org/t/p/original/abc.jpg",
        },
        5920,
        1,
      ).metadata.stillUrl,
    ).toBe("https://image.tmdb.org/t/p/w300/abc.jpg");
    expect(media.metadata.overview).toBe("The first one.");
    expect(media.metadata.runtimeMinutes).toBe(42);
    expect(media.preferredAction).toBe("REQUEST");
  });

  it("skips person results", () => {
    expect(
      mapSearchResultToMedia({
        id: 1,
        mediaType: "person",
        name: "Someone",
      }),
    ).toBeNull();
  });

  it("maps movie credits, genres, and studios", () => {
    const media = mapMovieDetailsToMedia({
      id: 550,
      title: "Fight Club",
      releaseDate: "1999-10-15",
      tagline: "Mischief. Mayhem. Soap.",
      genres: [{ id: 18, name: "Drama" }],
      productionCompanies: [{ id: 1, name: "Fox 2000 Pictures" }],
      keywords: [{ id: 1, name: "dual identity" }],
      credits: {
        cast: [
          {
            id: 819,
            name: "Edward Norton",
            character: "Narrator",
            order: 0,
            profilePath: "/norton.jpg",
          },
        ],
        crew: [
          { id: 7467, name: "David Fincher", job: "Director", profilePath: "/df.jpg" },
          { id: 1, name: "Jim Uhls", job: "Screenplay" },
        ],
      },
    });
    expect(media.metadata.tagline).toBe("Mischief. Mayhem. Soap.");
    expect(media.metadata.genres).toEqual(["Drama"]);
    expect(media.metadata.studios).toEqual(["Fox 2000 Pictures"]);
    expect(media.metadata.cast?.[0]).toMatchObject({
      name: "Edward Norton",
      role: "Narrator",
    });
    expect(media.metadata.cast?.[0]?.profileUrl).toContain("/w185/norton.jpg");
    expect(media.metadata.creators?.[0]?.name).toBe("David Fincher");
    expect(media.metadata.writers?.[0]?.name).toBe("Jim Uhls");
  });

  it("maps series creators from createdBy", () => {
    const media = mapTvDetailsToMedia({
      id: 1396,
      name: "Breaking Bad",
      createdBy: [{ id: 66633, name: "Vince Gilligan", profile_path: "/vg.jpg" }],
      genres: [{ id: 18, name: "Drama" }],
      credits: {
        cast: [{ id: 17419, name: "Bryan Cranston", character: "Walter White", order: 0 }],
      },
    });
    expect(media.metadata.creators?.[0]?.name).toBe("Vince Gilligan");
    expect(media.metadata.cast?.[0]?.name).toBe("Bryan Cranston");
  });
});
