import type { Media, MediaIdentity, ProviderHealth } from "@reclinarr/shared";
import { resolvePreferredAction } from "@reclinarr/shared";
import type { DiscoveryProvider, MediaRequestSummary, RequestProvider } from "../types.js";
import { SEERR_CAPABILITIES } from "../types.js";
import { requestableMovie } from "./fixtures.js";

const trendingTv: Media = {
  identity: { tmdbId: 1396, mediaType: "tv" },
  metadata: {
    title: "Breaking Bad",
    year: 2008,
    overview: "A chemistry teacher turned meth cook.",
  },
  availability: [{ provider: "seerr", requestable: true, mediaStatus: "UNKNOWN" }],
  preferredAction: "REQUEST",
};

const popularMovie: Media = {
  identity: { tmdbId: 27205, mediaType: "movie" },
  metadata: {
    title: "Inception",
    year: 2010,
    overview: "A thief who steals corporate secrets through dream-sharing.",
  },
  availability: [{ provider: "seerr", requestable: true, mediaStatus: "UNKNOWN" }],
  preferredAction: "REQUEST",
};

function withAction(media: Media): Media {
  return { ...media, preferredAction: resolvePreferredAction(media.availability) };
}

export class MockSeerrProvider implements DiscoveryProvider, RequestProvider {
  readonly id = "seerr";
  private requested = new Set<string>();

  capabilities() {
    return SEERR_CAPABILITIES;
  }

  async health(): Promise<ProviderHealth> {
    return { id: this.id, status: "ok", message: "mock", capabilities: this.capabilities() };
  }

  async discoverTrending(opts?: { mediaType?: "movie" | "tv" }): Promise<Media[]> {
    if (opts?.mediaType === "tv") return [withAction(trendingTv)];
    if (opts?.mediaType === "movie") return [withAction(requestableMovie), withAction(popularMovie)];
    return [withAction(requestableMovie), withAction(trendingTv), withAction(popularMovie)];
  }

  async discoverMovies(opts?: { page?: number; genreId?: number }): Promise<Media[]> {
    void opts;
    return [withAction(popularMovie), withAction(requestableMovie)];
  }

  async discoverTv(opts?: { page?: number; genreId?: number }): Promise<Media[]> {
    void opts;
    return [withAction(trendingTv)];
  }

  async search(query: string): Promise<Media[]> {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return [requestableMovie, popularMovie, trendingTv]
      .map(withAction)
      .filter((m) => m.metadata.title.toLowerCase().includes(q) || q.length < 2);
  }

  async listTvEpisodes(tmdbId: number): Promise<Media[]> {
    return [1, 2].map((episodeNumber) =>
      withAction({
        identity: { tmdbId, mediaType: "episode", seasonNumber: 1, episodeNumber },
        metadata: {
          title: `Episode ${episodeNumber}`,
          overview: "Mock Seerr episode",
        },
        availability: [{ provider: "seerr", requestable: true, mediaStatus: "UNKNOWN" }],
        preferredAction: "NONE",
      }),
    );
  }

  async getSimilar(mediaType: "movie" | "tv", _tmdbId: number): Promise<Media[]> {
    const pool = [requestableMovie, popularMovie, trendingTv].map(withAction);
    return pool.filter((m) => m.identity.mediaType === mediaType).slice(0, 8);
  }

  async getDetails(mediaType: "movie" | "tv", tmdbId: number): Promise<Media | null> {
    const all = [requestableMovie, popularMovie, trendingTv].map(withAction);
    const found = all.find(
      (m) => m.identity.tmdbId === tmdbId && m.identity.mediaType === mediaType,
    );
    if (!found) {
      return withAction({
        identity: { tmdbId, mediaType },
        metadata: {
          title: mediaType === "movie" ? `Movie ${tmdbId}` : `Series ${tmdbId}`,
          overview: "Mock Seerr details",
        },
        availability: [
          {
            provider: "seerr",
            requestable: !this.requested.has(`${mediaType}:${tmdbId}`),
            mediaStatus: this.requested.has(`${mediaType}:${tmdbId}`) ? "PENDING" : "UNKNOWN",
            requestStatus: this.requested.has(`${mediaType}:${tmdbId}`) ? "PENDING" : undefined,
          },
        ],
        preferredAction: "NONE",
      });
    }
    const key = `${mediaType}:${tmdbId}`;
    if (this.requested.has(key)) {
      return withAction({
        ...found,
        availability: [
          {
            provider: "seerr",
            requestable: false,
            mediaStatus: "PENDING",
            requestStatus: "PENDING",
          },
        ],
      });
    }
    return found;
  }

  async getRequestAvailability(identity: MediaIdentity) {
    if (!identity.tmdbId || (identity.mediaType !== "movie" && identity.mediaType !== "tv")) {
      return null;
    }
    const details = await this.getDetails(identity.mediaType, identity.tmdbId);
    return details?.availability.find((a) => a.provider === "seerr") ?? null;
  }

  async seerrUserIdForJellyfin(): Promise<number | null> {
    return 1;
  }

  async requestMedia(identity: MediaIdentity, _opts: { asUser: number }): Promise<void> {
    if (!identity.tmdbId || (identity.mediaType !== "movie" && identity.mediaType !== "tv")) {
      throw new Error("Mock Seerr requires tmdbId");
    }
    this.requested.add(`${identity.mediaType}:${identity.tmdbId}`);
  }

  async listRequests(opts?: {
    asUser: number;
    take?: number;
    skip?: number;
    mediaType?: "movie" | "tv" | "all";
  }): Promise<{ items: MediaRequestSummary[]; total: number }> {
    const items: MediaRequestSummary[] = [...this.requested].map((key, i) => {
      const [mediaType, tmdbId] = key.split(":");
      const media = [requestableMovie, popularMovie, trendingTv].find(
        (m) => String(m.identity.tmdbId) === tmdbId,
      );
      return {
        id: i + 1,
        mediaType: (mediaType === "tv" ? "tv" : "movie") as "movie" | "tv",
        tmdbId: Number(tmdbId),
        title: media?.metadata.title ?? `Request ${tmdbId}`,
        year: media?.metadata.year,
        posterUrl: media?.metadata.posterUrl,
        status: "PENDING",
        mediaStatus: "PENDING",
        createdAt: new Date().toISOString(),
      };
    });
    const filtered =
      opts?.mediaType && opts.mediaType !== "all"
        ? items.filter((i) => i.mediaType === opts.mediaType)
        : items;
    const skip = opts?.skip ?? 0;
    const take = opts?.take ?? 50;
    return { items: filtered.slice(skip, skip + take), total: filtered.length };
  }
}
