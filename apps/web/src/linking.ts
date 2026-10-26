import {
  getPathFromState as navGetPathFromState,
  getStateFromPath as navGetStateFromPath,
  type LinkingOptions,
} from "@react-navigation/native";
import type { MediaIdentity } from "@reclinarr/shared";
import type { PlayParams, RootStackParamList } from "./nav";

/**
 * Browse + deep-linkable Details/Player.
 * Player URL carries identity only — PlaybackSource is re-resolved on load.
 */
export const linkingConfig = {
  screens: {
    Boot: "",
    Home: "home",
    Movies: "movies",
    Series: "series",
    Search: "search",
    Live: "live",
    Downloads: "downloads",
    Requests: "requests",
    Settings: "settings",
    // Parsed manually in getStateFromPath so we can stack Home underneath.
    Details: "media/:type/:tmdbId",
    Player: "play",
    Login: "login",
  },
} as const;

function parseQuery(path: string): URLSearchParams {
  const q = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

function pathOnly(path: string): string {
  return path.replace(/^\//, "").split("?")[0] ?? "";
}

function titleFromQuery(params: URLSearchParams): string | undefined {
  const t = params.get("t")?.trim();
  return t || undefined;
}

function resumeFromQuery(params: URLSearchParams): number | undefined {
  const n = Number(params.get("p"));
  return Number.isFinite(n) && n > 30 ? Math.floor(n) : undefined;
}

function withPlayQuery(
  base: string,
  opts: { title?: string; resumeSeconds?: number },
): string {
  const q = new URLSearchParams();
  if (opts.title) q.set("t", opts.title);
  if (opts.resumeSeconds != null && opts.resumeSeconds > 30) {
    q.set("p", String(Math.floor(opts.resumeSeconds)));
  }
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

function identityFromPlayPath(clean: string): MediaIdentity | null {
  let m = clean.match(/^play\/movie\/(\d+)$/);
  if (m) return { mediaType: "movie", tmdbId: Number(m[1]) };

  m = clean.match(/^play\/tv\/(\d+)\/s\/(\d+)\/e\/(\d+)$/);
  if (m) {
    return {
      mediaType: "episode",
      tmdbId: Number(m[1]),
      seasonNumber: Number(m[2]),
      episodeNumber: Number(m[3]),
    };
  }

  m = clean.match(/^play\/tv\/(\d+)$/);
  if (m) return { mediaType: "tv", tmdbId: Number(m[1]) };

  m = clean.match(/^play\/jellyfin\/([^/]+)$/);
  if (m) return { mediaType: "other", jellyfinItemId: decodeURIComponent(m[1]) };

  return null;
}

function playPathFromParams(params: PlayParams | undefined): string | null {
  if (!params) return null;
  if (params.live && params.channelUuid) {
    return withPlayQuery(`/play/live/${encodeURIComponent(params.channelUuid)}`, {
      title: params.title,
      resumeSeconds: params.resumeSeconds,
    });
  }
  const id = params.identity;
  if (!id) return null;

  let base: string | null = null;
  // Prefer TMDb episode/movie paths so reload resume keys stay stable.
  if (
    (id.mediaType === "episode" || id.mediaType === "tv") &&
    id.tmdbId != null &&
    id.seasonNumber != null &&
    id.episodeNumber != null
  ) {
    base = `/play/tv/${id.tmdbId}/s/${id.seasonNumber}/e/${id.episodeNumber}`;
  } else if (id.mediaType === "movie" && id.tmdbId) {
    base = `/play/movie/${id.tmdbId}`;
  } else if (id.mediaType === "tv" && id.tmdbId) {
    base = `/play/tv/${id.tmdbId}`;
  } else if (id.tmdbId && (id.mediaType === "other" || id.mediaType === "movie")) {
    base = `/play/movie/${id.tmdbId}`;
  } else if (id.jellyfinItemId) {
    base = `/play/jellyfin/${encodeURIComponent(id.jellyfinItemId)}`;
  }

  if (!base) return null;
  return withPlayQuery(base, {
    title: params.title,
    resumeSeconds: params.resumeSeconds,
  });
}

function withBrowseUnderlay(
  top: { name: keyof RootStackParamList; params?: object },
): { routes: Array<{ name: string; params?: object }>; index: number } {
  return {
    routes: [{ name: "Home" }, top],
    index: 1,
  };
}

export const webLinking: LinkingOptions<RootStackParamList> = {
  prefixes: ["/"],
  config: linkingConfig,
  getStateFromPath(path, options) {
    const clean = pathOnly(path);
    const query = parseQuery(path);

    // Details — keep Home under the transparent modal so reload isn't a black void.
    const details = clean.match(/^media\/(movie|tv)\/(\d+)$/);
    if (details) {
      return withBrowseUnderlay({
        name: "Details",
        params: {
          type: details[1] as "movie" | "tv",
          tmdbId: Number(details[2]),
        },
      });
    }
    const jfDetails = clean.match(/^media\/jellyfin\/([^/]+)$/);
    if (jfDetails) {
      return withBrowseUnderlay({
        name: "Details",
        params: { jellyfinItemId: decodeURIComponent(jfDetails[1]) },
      });
    }

    // Live / VOD play — opaque fullscreen, no Home underlay (avoids /api/home
    // fighting a slow resolve and remounting the player mid-resume).
    const live = clean.match(/^play\/live\/([^/]+)$/);
    if (live) {
      return {
        routes: [
          {
            name: "Player",
            params: {
              live: true,
              channelUuid: decodeURIComponent(live[1]),
              title: titleFromQuery(query),
              resumeSeconds: resumeFromQuery(query),
            },
          },
        ],
        index: 0,
      };
    }

    const identity = identityFromPlayPath(clean);
    if (identity) {
      return {
        routes: [
          {
            name: "Player",
            params: {
              identity,
              title: titleFromQuery(query),
              resumeSeconds: resumeFromQuery(query),
            },
          },
        ],
        index: 0,
      };
    }

    if (clean === "profile") {
      return { routes: [{ name: "Settings" }], index: 0 };
    }

    // Bare /play with no identity — browse home.
    if (clean === "play") {
      return { routes: [{ name: "Home" }], index: 0 };
    }

    return navGetStateFromPath(path, options);
  },
  getPathFromState(state, options) {
    const index = state.index ?? state.routes.length - 1;
    const route = state.routes[index];
    if (!route) return navGetPathFromState(state, options);

    if (route.name === "Player") {
      const path = playPathFromParams(route.params as PlayParams | undefined);
      if (path) return path;
    }

    if (route.name === "Details") {
      const p = route.params as RootStackParamList["Details"] | undefined;
      if (p && "jellyfinItemId" in p && p.jellyfinItemId) {
        return `/media/jellyfin/${encodeURIComponent(p.jellyfinItemId)}`;
      }
      if (p && "type" in p && p.type && p.tmdbId != null) {
        return `/media/${p.type}/${p.tmdbId}`;
      }
    }

    return navGetPathFromState(state, options);
  },
};
