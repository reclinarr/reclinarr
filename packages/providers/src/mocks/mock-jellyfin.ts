import type { Media, MediaIdentity, PlaybackSource, ProviderHealth } from "@reclinarr/shared";
import { resolvePreferredAction } from "@reclinarr/shared";
import type { LibraryProvider, PlaybackProvider, UserContext } from "../types.js";
import { JELLYFIN_CAPABILITIES } from "../types.js";

const library: Media[] = [
  {
    identity: { jellyfinItemId: "jf-zootopia", tmdbId: 269149, mediaType: "movie" },
    metadata: {
      title: "Zootopia",
      year: 2016,
      overview: "In a city of anthropomorphic animals...",
      posterUrl: undefined,
    },
    availability: [
      {
        provider: "jellyfin",
        available: true,
        itemId: "jf-zootopia",
        canPlay: true,
        qualityLabel: "1080p",
        positionSeconds: 1200,
        durationSeconds: 6500,
      },
    ],
    preferredAction: "PLAY_JELLYFIN",
  },
  {
    identity: { jellyfinItemId: "jf-home-video", mediaType: "other" },
    metadata: {
      title: "Family Vacation 2019",
      overview: "Unidentified home video — no TMDb id.",
    },
    availability: [
      {
        provider: "jellyfin",
        available: true,
        itemId: "jf-home-video",
        canPlay: true,
      },
    ],
    preferredAction: "PLAY_JELLYFIN",
  },
  {
    identity: {
      jellyfinItemId: "jf-mrrobot-s01e01",
      tmdbId: 62560,
      mediaType: "episode",
      seasonNumber: 1,
      episodeNumber: 1,
    },
    metadata: {
      title: "Mr. Robot S1E1",
      year: 2015,
      overview: "eps1.0_hellofriend.mov",
    },
    availability: [
      {
        provider: "jellyfin",
        available: true,
        itemId: "jf-mrrobot-s01e01",
        canPlay: true,
        positionSeconds: 300,
        durationSeconds: 3600,
      },
    ],
    preferredAction: "PLAY_JELLYFIN",
  },
];

for (const m of library) {
  m.preferredAction = resolvePreferredAction(m.availability);
}

export class MockJellyfinProvider implements LibraryProvider, PlaybackProvider {
  readonly id = "jellyfin";

  capabilities() {
    return JELLYFIN_CAPABILITIES;
  }

  async health(): Promise<ProviderHealth> {
    return { id: this.id, status: "ok", message: "mock", capabilities: this.capabilities() };
  }

  async isAdministrator(): Promise<boolean> {
    return false;
  }

  async authenticate() {
    return {
      userId: "mock-user",
      username: "Demo",
      accessToken: "mock-token",
      serverId: "mock-server",
    };
  }

  async getContinueWatching(_ctx: UserContext): Promise<Media[]> {
    return library.filter((m) =>
      m.availability.some(
        (a) => a.provider === "jellyfin" && (a.positionSeconds ?? 0) > 0,
      ),
    );
  }

  async getNextUp(_ctx: UserContext): Promise<Media[]> {
    return [];
  }

  async getRecentlyAdded(_ctx: UserContext): Promise<Media[]> {
    return library;
  }

  async listLibrary(
    _ctx: UserContext,
    opts: {
      mediaType: "movie" | "tv";
      startIndex?: number;
      limit?: number;
      search?: string;
    },
  ): Promise<{ items: Media[]; total: number }> {
    let items = library.filter((m) =>
      opts.mediaType === "movie"
        ? m.identity.mediaType === "movie"
        : m.identity.mediaType === "tv" || m.identity.mediaType === "episode",
    );
    if (opts.search?.trim()) {
      const q = opts.search.trim().toLowerCase();
      items = items.filter((m) => m.metadata.title.toLowerCase().includes(q));
    }
    const start = opts.startIndex ?? 0;
    const limit = opts.limit ?? 48;
    return { items: items.slice(start, start + limit), total: items.length };
  }

  async getByJellyfinItemId(_ctx: UserContext, itemId: string): Promise<Media | null> {
    return library.find((m) => m.identity.jellyfinItemId === itemId) ?? null;
  }

  async findByTmdb(_ctx: UserContext, tmdbId: number): Promise<Media | null> {
    return library.find((m) => m.identity.tmdbId === tmdbId) ?? null;
  }

  async listEpisodesForSeries(_ctx: UserContext, seriesItemId: string): Promise<Media[]> {
    return library.filter(
      (m) =>
        m.identity.mediaType === "episode" &&
        (m.identity.jellyfinItemId === seriesItemId ||
          m.metadata.title.toLowerCase().includes("episode")),
    );
  }

  async resolvePlayback(
    _ctx: UserContext,
    identity: MediaIdentity,
    opts?: {
      startPositionSeconds?: number;
      audioStreamIndex?: number;
      preferredAudioLanguage?: string;
    },
  ): Promise<PlaybackSource | null> {
    if (!identity.jellyfinItemId) return null;
    const media = library.find((m) => m.identity.jellyfinItemId === identity.jellyfinItemId);
    if (!media) return null;
    const saved =
      media.availability.find((a) => a.provider === "jellyfin")?.positionSeconds ?? 0;
    return {
      provider: "jellyfin",
      delivery: {
        mode: "direct",
        // Public sample asset so the web player chrome can be exercised in mock mode.
        url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
      },
      directPlay: true,
      playMethod: "DirectPlay",
      hls: false,
      mimeType: "video/mp4",
      itemId: identity.jellyfinItemId,
      mediaSourceId: "mock",
      playSessionId: "mock-session",
      startPositionSeconds:
        opts?.startPositionSeconds != null && opts.startPositionSeconds > 0
          ? opts.startPositionSeconds
          : saved,
    };
  }

  async reportProgress(): Promise<void> {
    // no-op
  }

  async refreshLibrary(): Promise<void> {
    // no-op
  }

  async notifyLibraryPathsUpdated(): Promise<void> {
    // no-op
  }
}
