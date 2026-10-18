import type {
  LiveChannel,
  LiveChannelGroup,
  LiveNowNext,
  Media,
  MediaIdentity,
  PlaybackSource,
  ProviderHealth,
} from "@reclinarr/shared";
import type { LiveTvProvider, VodProvider } from "../types.js";
import { DISPATCHARR_CAPABILITIES } from "../types.js";
import { dispatcharrOnlyMovie } from "./fixtures.js";

const mockGroups: LiveChannelGroup[] = [
  { id: "1", name: "Entertainment" },
  { id: "2", name: "News" },
];

const mockChannels: LiveChannel[] = [
  {
    id: "101",
    uuid: "11111111-1111-1111-1111-111111111101",
    name: "Reclinarr One",
    number: 1,
    groupId: "1",
    groupName: "Entertainment",
    tvgId: "reclinarr.one",
  },
  {
    id: "102",
    uuid: "11111111-1111-1111-1111-111111111102",
    name: "Reclinarr News",
    number: 2,
    groupId: "2",
    groupName: "News",
    tvgId: "reclinarr.news",
  },
];

export class MockDispatcharrProvider implements VodProvider, LiveTvProvider {
  readonly id = "dispatcharr";

  capabilities() {
    return DISPATCHARR_CAPABILITIES;
  }

  async health(): Promise<ProviderHealth> {
    return { id: this.id, status: "ok", message: "mock", capabilities: this.capabilities() };
  }

  async findVodByTmdb(
    tmdbId: number,
    mediaType: "movie" | "tv",
    _opts?: { titleHint?: string; yearHint?: number; dispatcharrId?: number },
  ): Promise<Media | null> {
    if (mediaType !== "movie") return null;
    if (tmdbId === dispatcharrOnlyMovie.identity.tmdbId) return dispatcharrOnlyMovie;
    return null;
  }

  async listEpisodesForSeries(): Promise<Media[]> {
    return [];
  }

  async findEpisodeBySeriesTmdb(
    _seriesTmdbId: number,
    _seasonNumber: number,
    _episodeNumber: number,
    _opts?: { titleHint?: string },
  ): Promise<Media | null> {
    return null;
  }

  async resolvePlaybackFromUuid(
    uuid: string,
    kind: "movie" | "episode",
    streamId?: string,
    opts?: { durationSeconds?: number },
  ): Promise<PlaybackSource> {
    const qs = new URLSearchParams({ kind });
    if (streamId) qs.set("streamId", streamId);
    return {
      provider: "dispatcharr",
      delivery: {
        mode: "proxy",
        url: `/api/playback/dispatcharr/vod/${uuid}?${qs}`,
      },
      directPlay: true,
      mimeType: "video/mp4",
      ...(opts?.durationSeconds != null ? { durationSeconds: opts.durationSeconds } : {}),
    };
  }

  async resolveVodPlayback(identity: MediaIdentity): Promise<PlaybackSource | null> {
    if (identity.tmdbId !== dispatcharrOnlyMovie.identity.tmdbId) return null;
    const avail = dispatcharrOnlyMovie.availability.find((a) => a.provider === "dispatcharr");
    if (!avail?.uuid) return null;
    return {
      provider: "dispatcharr",
      delivery: {
        mode: "proxy",
        url: `http://localhost:8787/api/playback/dispatcharr/vod/${avail.uuid}?kind=movie`,
      },
      directPlay: true,
      mimeType: "video/mp4",
      durationSeconds:
        dispatcharrOnlyMovie.metadata.runtimeMinutes != null
          ? dispatcharrOnlyMovie.metadata.runtimeMinutes * 60
          : undefined,
    };
  }

  async listChannelGroups(): Promise<LiveChannelGroup[]> {
    return mockGroups;
  }

  async listChannels(opts?: {
    groupId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    favouritesOnly?: boolean;
    favouriteUuids?: string[];
  }): Promise<{ items: LiveChannel[]; total: number }> {
    const fav = new Set(opts?.favouriteUuids ?? []);
    let items = mockChannels.map((c) => ({ ...c, favourite: fav.has(c.uuid) }));
    if (opts?.favouritesOnly) items = items.filter((c) => fav.has(c.uuid));
    else if (opts?.groupId) items = items.filter((c) => c.groupId === opts.groupId);
    if (opts?.search) {
      const q = opts.search.toLowerCase();
      items = items.filter((c) => c.name.toLowerCase().includes(q));
    }
    const page = opts?.page ?? 1;
    const pageSize = opts?.pageSize ?? 50;
    const start = (page - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), total: items.length };
  }

  async getChannel(uuid: string): Promise<LiveChannel | null> {
    return mockChannels.find((c) => c.uuid === uuid) ?? null;
  }

  async getNowNext(channelUuids: string[]): Promise<LiveNowNext[]> {
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 60_000);
    return channelUuids.map((uuid) => {
      const ch = mockChannels.find((c) => c.uuid === uuid);
      return {
        channelUuid: uuid,
        now: {
          channelId: ch?.tvgId ?? uuid,
          channelUuid: uuid,
          title: ch ? `Now on ${ch.name}` : "Live",
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          isLive: true,
        },
        next: {
          channelId: ch?.tvgId ?? uuid,
          channelUuid: uuid,
          title: "Up next",
          startsAt: end.toISOString(),
          endsAt: new Date(end.getTime() + 30 * 60_000).toISOString(),
        },
      };
    });
  }

  async getGuideWindow(): Promise<import("@reclinarr/shared").EpgProgramme[]> {
    return [];
  }

  async resolveLivePlayback(channelUuid: string): Promise<PlaybackSource | null> {
    if (!mockChannels.some((c) => c.uuid === channelUuid)) return null;
    return {
      provider: "dispatcharr",
      delivery: {
        mode: "direct",
        url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
      },
      directPlay: true,
      mimeType: "video/mp4",
    };
  }
}
