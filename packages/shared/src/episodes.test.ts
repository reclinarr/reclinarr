import { describe, expect, it } from "vitest";
import { isWatchedByAvailability, pickNextUpEpisode, type EpisodeListItem } from "./episodes.js";
import type { Availability } from "./media.js";

const jellyfin = (extra: Record<string, unknown>): Availability => ({
  provider: "jellyfin",
  available: true,
  canPlay: true,
  ...extra,
});

describe("isWatchedByAvailability", () => {
  it("trusts Jellyfin's played flag even with no position", () => {
    expect(isWatchedByAvailability([jellyfin({ played: true, positionSeconds: 0 })])).toBe(true);
  });

  it("is watched at the threshold and not below it", () => {
    expect(
      isWatchedByAvailability([jellyfin({ positionSeconds: 2700, durationSeconds: 3000 })]),
    ).toBe(true);
    expect(
      isWatchedByAvailability([jellyfin({ positionSeconds: 2690, durationSeconds: 3000 })]),
    ).toBe(false);
  });

  it("is not watched when nothing has been played", () => {
    expect(isWatchedByAvailability([jellyfin({ played: false })])).toBe(false);
    expect(isWatchedByAvailability([])).toBe(false);
  });
});

function ep(season: number, episode: number, extra: Partial<EpisodeListItem> = {}): EpisodeListItem {
  return {
    identity: { mediaType: "episode", seasonNumber: season, episodeNumber: episode },
    title: `S${season}E${episode}`,
    seasonNumber: season,
    episodeNumber: episode,
    availability: [],
    preferredAction: "NONE",
    ...extra,
  };
}

describe("pickNextUpEpisode", () => {
  const playable = () => true;

  it("returns null when nothing has been watched", () => {
    expect(pickNextUpEpisode([ep(1, 1), ep(1, 2)], playable)).toBeNull();
  });

  it("picks the first unwatched episode after the furthest watched, across seasons", () => {
    const items = [ep(1, 1, { watched: true }), ep(1, 2, { watched: true }), ep(2, 1), ep(2, 2)];
    expect(pickNextUpEpisode(items, playable)?.title).toBe("S2E1");
  });

  it("skips episodes that are not playable", () => {
    const items = [ep(1, 1, { watched: true }), ep(1, 2), ep(1, 3)];
    expect(pickNextUpEpisode(items, (e) => e.episodeNumber === 3)?.title).toBe("S1E3");
  });

  it("ignores specials when finding the furthest watched", () => {
    const items = [ep(0, 1, { watched: true }), ep(1, 1), ep(1, 2)];
    expect(pickNextUpEpisode(items, playable)).toBeNull();
  });

  it("prefers the episode the user opened when it is unwatched and playable", () => {
    const items = [ep(1, 1, { watched: true }), ep(1, 2), ep(1, 3)];
    expect(pickNextUpEpisode(items, playable, { seasonNumber: 1, episodeNumber: 3 })?.title).toBe(
      "S1E3",
    );
  });

  it("returns null when everything is watched", () => {
    expect(pickNextUpEpisode([ep(1, 1, { watched: true })], playable)).toBeNull();
  });
});
