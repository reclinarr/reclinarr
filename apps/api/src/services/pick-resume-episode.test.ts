import { describe, expect, it } from "vitest";
import { pickResumeEpisode } from "./pick-resume-episode.js";

describe("pickResumeEpisode", () => {
  it("prefers the most recently watched episode over earlier S/E order", () => {
    const picked = pickResumeEpisode([
      {
        seasonNumber: 1,
        episodeNumber: 9,
        positionSeconds: 600,
        updatedAtMs: 1_000,
      },
      {
        seasonNumber: 4,
        episodeNumber: 1,
        positionSeconds: 900,
        updatedAtMs: 2_000,
      },
    ]);
    expect(picked).toEqual({
      seasonNumber: 4,
      episodeNumber: 1,
      positionSeconds: 900,
    });
  });

  it("ignores progress at or under 30 seconds", () => {
    expect(
      pickResumeEpisode([
        { seasonNumber: 1, episodeNumber: 1, positionSeconds: 10, updatedAtMs: 9_000 },
        { seasonNumber: 2, episodeNumber: 3, positionSeconds: 45, updatedAtMs: 1_000 },
      ]),
    ).toEqual({
      seasonNumber: 2,
      episodeNumber: 3,
      positionSeconds: 45,
    });
  });

  it("returns null when nothing is eligible", () => {
    expect(pickResumeEpisode([])).toBeNull();
    expect(
      pickResumeEpisode([
        { seasonNumber: 1, episodeNumber: 1, positionSeconds: 5, updatedAtMs: 1 },
      ]),
    ).toBeNull();
  });
});
