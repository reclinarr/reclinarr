import { resolvePlaybackForPlay } from "@reclinarr/client";
import type { KeyValueStorage } from "@reclinarr/client";
import type { MediaIdentity, PlaybackSource } from "@reclinarr/shared";

/** Dedupe in-flight reload resolves so Strict Mode / remounts don't drop the result. */
const inflight = new Map<string, Promise<PlaybackSource>>();

/**
 * Stable across in-app play (may include jellyfinItemId) and URL reload
 * (`/play/movie/123` identity has tmdbId only). Netflix-style resume keys
 * must match both paths.
 */
export function playResumeKey(identity: MediaIdentity): string {
  if (identity.tmdbId != null) {
    if (
      (identity.mediaType === "episode" || identity.mediaType === "tv") &&
      identity.seasonNumber != null &&
      identity.episodeNumber != null
    ) {
      return `reclinarr.playResume:tv:${identity.tmdbId}:s${identity.seasonNumber}:e${identity.episodeNumber}`;
    }
    if (identity.mediaType === "movie" || identity.mediaType === "other") {
      return `reclinarr.playResume:movie:${identity.tmdbId}`;
    }
    return `reclinarr.playResume:${identity.mediaType}:${identity.tmdbId}`;
  }
  if (identity.jellyfinItemId) {
    return `reclinarr.playResume:jellyfin:${identity.jellyfinItemId}`;
  }
  return `reclinarr.playResume:unknown`;
}

export function liveResumeKey(channelUuid: string): string {
  return `reclinarr.playResume:live:${channelUuid}`;
}

export async function loadResumeSeconds(
  storage: KeyValueStorage,
  key: string,
): Promise<number | undefined> {
  try {
    const raw = await storage.getItem(key);
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 30 ? Math.floor(n) : undefined;
  } catch {
    return undefined;
  }
}

export async function saveResumeSeconds(
  storage: KeyValueStorage,
  key: string,
  seconds: number,
): Promise<void> {
  if (!(seconds > 30) || !Number.isFinite(seconds)) return;
  try {
    await storage.setItem(key, String(Math.floor(seconds)));
  } catch {
    /* ignore quota */
  }
}

/** Mirror position into `?p=` so a hard refresh still has the offset. */
export function syncResumeToUrl(seconds: number): void {
  if (typeof window === "undefined") return;
  if (!(seconds > 30) || !Number.isFinite(seconds)) return;
  try {
    const url = new URL(window.location.href);
    if (!url.pathname.startsWith("/play/")) return;
    const next = String(Math.floor(seconds));
    if (url.searchParams.get("p") === next) return;
    url.searchParams.set("p", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  } catch {
    /* ignore */
  }
}

export function resumeSecondsFromUrl(): number | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const n = Number(new URL(window.location.href).searchParams.get("p"));
    return Number.isFinite(n) && n > 30 ? Math.floor(n) : undefined;
  } catch {
    return undefined;
  }
}

export function pickResumeSeconds(...candidates: Array<number | undefined>): number | undefined {
  let best: number | undefined;
  for (const c of candidates) {
    if (c != null && Number.isFinite(c) && c > 30 && (best == null || c > best)) best = Math.floor(c);
  }
  return best;
}

export function resolvePlaybackForResume(
  cacheKey: string,
  identity: MediaIdentity,
  opts?: Parameters<typeof resolvePlaybackForPlay>[1],
): Promise<PlaybackSource> {
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const promise = resolvePlaybackForPlay(identity, opts)
    .then((source) => {
      const start = opts?.startPositionSeconds;
      if (
        start != null &&
        start > 30 &&
        !(source.startPositionSeconds && source.startPositionSeconds > 30)
      ) {
        return { ...source, startPositionSeconds: start };
      }
      // Prefer the newer of client resume vs Continu Watching from the server.
      if (
        start != null &&
        start > 30 &&
        source.startPositionSeconds != null &&
        start > source.startPositionSeconds + 15
      ) {
        return { ...source, startPositionSeconds: start };
      }
      return source;
    })
    .finally(() => {
      window.setTimeout(() => {
        if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey);
      }, 10_000);
    });

  inflight.set(cacheKey, promise);
  return promise;
}
