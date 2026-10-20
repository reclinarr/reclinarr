import { SESSION_COOKIE } from "./session.js";

/**
 * Rewrite Jellyfin HLS playlists so every URI goes through Reclinarr's
 * `/api/playback/jellyfin/hls` proxy (tokens stay server-side).
 * Tag lines without URI= (including `#EXT-X-ENDLIST`) are left unchanged.
 *
 * Optional sessionId is embedded in each proxy URL so React Native / AVPlayer
 * can auth segment requests (custom headers are not reliable on HLS).
 */
export function rewriteHlsPlaylist(
  playlist: string,
  context: {
    transcodingPath?: string;
    path?: string;
    sessionId?: string;
    /** e.g. http://192.168.1.220:8787 — absolute segment URLs help AVPlayer. */
    publicOrigin?: string;
  },
): string {
  const baseDir = (() => {
    const raw = context.transcodingPath ?? context.path ?? "";
    const withoutQuery = raw.split("?")[0] ?? "";
    const idx = withoutQuery.lastIndexOf("/");
    return idx >= 0 ? withoutQuery.slice(0, idx + 1) : "/";
  })();

  return playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        if (trimmed.includes("URI=")) {
          return trimmed.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
            return `URI="${toHlsProxyUrl(resolveJellyfinUri(uri, baseDir), context.sessionId, context.publicOrigin)}"`;
          });
        }
        return line;
      }
      return toHlsProxyUrl(
        resolveJellyfinUri(trimmed, baseDir),
        context.sessionId,
        context.publicOrigin,
      );
    })
    .join("\n");
}

export function resolveJellyfinUri(uri: string, baseDir: string): string {
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    try {
      const u = new URL(uri);
      return `${u.pathname}${u.search}`;
    } catch {
      return uri;
    }
  }
  if (uri.startsWith("/")) return uri;
  return `${baseDir}${uri}`;
}

export function toHlsProxyUrl(
  jellyfinPath: string,
  sessionId?: string,
  publicOrigin?: string,
): string {
  let url = `/api/playback/jellyfin/hls?path=${encodeURIComponent(jellyfinPath)}`;
  if (sessionId) {
    url += `&${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`;
  }
  if (publicOrigin) {
    return `${publicOrigin.replace(/\/$/, "")}${url}`;
  }
  return url;
}

/** True for loopback / RFC1918 / .local — cleartext HTTP is fine for these. */
export function isLocalPlaybackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h === "::1" || h.endsWith(".local")) return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h)) return true;
  return false;
}

/**
 * Absolute origin for HLS segment URLs. iOS ATS blocks cleartext HTTP to public
 * hosts, so non-local origins are forced to https even when the worker only
 * sees plain HTTP behind a TLS terminator that omitted X-Forwarded-Proto.
 */
export function normalizePublicOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    if (u.protocol === "http:" && !isLocalPlaybackHost(u.hostname)) {
      u.protocol = "https:";
    }
    return u.origin;
  } catch {
    return origin.replace(/\/$/, "");
  }
}

function headerString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
    return value[0].trim();
  }
  return undefined;
}

/** Origin the client used to reach us (LAN IP on phone, not localhost). */
export function requestPublicOrigin(
  req: {
    protocol?: string;
    headers: Record<string, unknown>;
  },
  /** Prefer RECLINARR_PUBLIC_URL when set (correct scheme in production). */
  configuredPublicUrl?: string,
): string | undefined {
  if (configuredPublicUrl?.trim()) {
    try {
      return normalizePublicOrigin(new URL(configuredPublicUrl.trim()).origin);
    } catch {
      /* fall through to request-derived origin */
    }
  }

  const host = headerString(req.headers.host);
  if (!host) return undefined;
  const xf = headerString(req.headers["x-forwarded-proto"]);
  const proto = xf
    ? xf.split(",")[0]!.trim()
    : req.protocol === "https"
      ? "https"
      : "http";
  return normalizePublicOrigin(`${proto}://${host}`);
}

/**
 * Force AVPlayer to start at the beginning of cache/event playlists.
 * Broken incremental packs used a high MEDIA-SEQUENCE; players then opened
 * near the live edge (~25% of a full movie scrubber).
 */
export function normalizeCacheHlsPlaylist(playlist: string): string {
  const lines = playlist.split("\n");
  const out: string[] = [];
  let sawStart = false;
  let sawMediaSequence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      if (!sawMediaSequence) {
        out.push("#EXT-X-MEDIA-SEQUENCE:0");
        sawMediaSequence = true;
      }
      continue;
    }
    if (trimmed.startsWith("#EXT-X-START:")) {
      if (!sawStart) {
        out.push("#EXT-X-START:TIME-OFFSET=0,PRECISE=YES");
        sawStart = true;
      }
      continue;
    }
    out.push(line);
  }
  if (!sawStart) {
    const versionIdx = out.findIndex((l) => l.trim().startsWith("#EXT-X-VERSION:"));
    const m3uIdx = out.findIndex((l) => l.trim() === "#EXTM3U");
    const insertAt = versionIdx >= 0 ? versionIdx + 1 : m3uIdx >= 0 ? m3uIdx + 1 : 0;
    out.splice(insertAt, 0, "#EXT-X-START:TIME-OFFSET=0,PRECISE=YES");
  }
  if (!sawMediaSequence) {
    const startIdx = out.findIndex((l) => l.trim().startsWith("#EXT-X-START:"));
    const versionIdx = out.findIndex((l) => l.trim().startsWith("#EXT-X-VERSION:"));
    const insertAt =
      startIdx >= 0 ? startIdx + 1 : versionIdx >= 0 ? versionIdx + 1 : 1;
    out.splice(insertAt, 0, "#EXT-X-MEDIA-SEQUENCE:0");
  }
  return out.join("\n");
}

/** Embed session on relative/absolute segment lines in a cache (on-disk) playlist. */
export function embedSessionInPlaylist(playlist: string, sessionId: string): string {
  if (!sessionId) return playlist;
  return playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        if (trimmed.includes("URI=")) {
          return trimmed.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
            return `URI="${withSessionQuery(uri, sessionId)}"`;
          });
        }
        return line;
      }
      return withSessionQuery(trimmed, sessionId);
    })
    .join("\n");
}

function withSessionQuery(uri: string, sessionId: string): string {
  if (uri.startsWith("http://") || uri.startsWith("https://") || uri.startsWith("/")) {
    try {
      const u = new URL(uri, "http://reclinarr.local");
      u.searchParams.set(SESSION_COOKIE, sessionId);
      if (uri.startsWith("http://") || uri.startsWith("https://")) return u.href;
      return `${u.pathname}${u.search}`;
    } catch {
      /* fall through */
    }
  }
  const sep = uri.includes("?") ? "&" : "?";
  return `${uri}${sep}${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`;
}
