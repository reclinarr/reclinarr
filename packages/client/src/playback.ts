import type { MediaIdentity, PlaybackSource, SubtitleTrack } from "@reclinarr/shared";
import { SESSION_COOKIE, SESSION_HEADER } from "./session.js";
import { maxSeekableSecondsForSource } from "./seek-cap.js";

export type PlaybackKind = "hls" | "mpegts" | "progressive";

export function classifyPlayback(source: PlaybackSource): PlaybackKind {
  const url = source.delivery.url;
  const mime = source.mimeType ?? "";
  // HLS first — live remux lives under /playback/dispatcharr/live/.../hls/
  if (
    Boolean(source.hls) ||
    url.includes("m3u8") ||
    mime.includes("mpegurl")
  ) {
    return "hls";
  }
  if (
    mime.includes("mp2t") ||
    (url.includes("/playback/dispatcharr/live/") && !url.includes("/hls/"))
  ) {
    return "mpegts";
  }
  return "progressive";
}

/** Browser origin without requiring DOM lib (client is shared with RN/Node). */
function browserOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return typeof loc?.origin === "string" ? loc.origin : "";
}

export function absoluteUrl(url: string, origin: string): string {
  try {
    const base = origin || browserOrigin() || "http://localhost:8787";
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/**
 * Absolute playback URL with session in the query string for native players
 * (AVPlayer / ExoPlayer) that cannot reliably send auth headers on HLS segments.
 */
export function playbackMediaUrl(
  url: string,
  origin: string,
  sessionId?: string | null,
): string {
  const href = absoluteUrl(url, origin);
  if (!sessionId) return href;
  try {
    const parsed = new URL(href);
    // Only Reclinarr's own API gets the session, never another host's /api/ path.
    if (!parsed.pathname.startsWith("/api/") || parsed.origin !== new URL(origin).origin) return href;
    parsed.searchParams.set(SESSION_COOKIE, sessionId);
    return parsed.href;
  } catch {
    return href;
  }
}

export function sessionCookieHeader(sessionId: string | null | undefined): Record<string, string> {
  if (!sessionId) return {};
  const headers: Record<string, string> = {
    // Fetch-safe on React Native (Cookie is a forbidden request header there).
    [SESSION_HEADER]: sessionId,
  };
  // Browsers can send Cookie; RN silently drops it — keep for web/TV where it helps.
  const nav = (globalThis as { navigator?: { product?: string } }).navigator;
  const product = typeof nav?.product === "string" ? nav.product : "";
  if (product !== "ReactNative") {
    headers.Cookie = `${SESSION_COOKIE}=${sessionId}`;
  }
  return headers;
}

export function isIptvProgressSource(
  provider: PlaybackSource["provider"] | undefined,
  live: boolean,
  identity?: MediaIdentity,
): boolean {
  return (provider === "dispatcharr" || provider === "cache") && Boolean(identity?.tmdbId) && !live;
}

export function seekCapForSource(source: PlaybackSource, knownDuration: number): number {
  return maxSeekableSecondsForSource({
    provider: source.provider,
    downloadComplete: Boolean(source.downloadComplete),
    downloadBytes: source.bytesDownloaded ?? 0,
    downloadTotal: source.totalBytes,
    knownDuration,
  });
}

export function textSubtitles(
  tracks: SubtitleTrack[] | undefined,
): Array<SubtitleTrack & { url: string }> {
  return (tracks ?? []).filter(
    (track): track is SubtitleTrack & { url: string } => Boolean(track.url),
  );
}

export function withCatalogueDuration(
  source: PlaybackSource,
  meta?: { durationSeconds?: number; runtimeMinutes?: number } | null,
): PlaybackSource {
  if (source.durationSeconds != null && source.durationSeconds > 0) return source;
  const fromMeta =
    meta?.durationSeconds != null && meta.durationSeconds > 0
      ? meta.durationSeconds
      : meta?.runtimeMinutes != null && meta.runtimeMinutes > 0
        ? meta.runtimeMinutes * 60
        : undefined;
  if (fromMeta == null) return source;
  return { ...source, durationSeconds: fromMeta };
}

export function formatCacheTtlRemaining(cacheExpiresAt?: string | null): string | null {
  if (!cacheExpiresAt) return null;
  const ms = Date.parse(cacheExpiresAt) - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "expires soon";
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days >= 2) return `${days} days left`;
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours >= 2) return `${hours} hours left`;
  return "under an hour left";
}

export function resumeSecondsFromSource(source: PlaybackSource): number {
  const start = source.startPositionSeconds;
  if (start != null && start > 30) return start;
  return 0;
}
