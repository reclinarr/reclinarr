import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Acquisition, Media, MediaIdentity } from "@reclinarr/shared";
import { listAcquisitions, startAcquisition } from "@reclinarr/client";
import { useIsDemoUser } from "./useMediaRequest.js";

const ACTIVE_STATES = ["queued", "downloading", "playable"] as const;

export function acquisitionProgressPercent(
  item: Pick<Acquisition, "state" | "bytesDownloaded" | "totalBytes">,
): number | null {
  if (item.state === "completed") return 100;
  if (item.totalBytes && item.totalBytes > 0) {
    return Math.min(99, Math.round((item.bytesDownloaded / item.totalBytes) * 100));
  }
  return null;
}

export function matchAcquisition(
  items: Acquisition[] | undefined,
  identity: MediaIdentity,
): Acquisition | undefined {
  if (!items?.length) return undefined;
  return items.find((item) => {
    const id = item.identity;
    if (identity.jellyfinItemId && id.jellyfinItemId === identity.jellyfinItemId) return true;
    if (identity.tmdbId == null || id.tmdbId !== identity.tmdbId) return false;
    if (identity.mediaType === "episode" || identity.seasonNumber != null) {
      return (
        id.seasonNumber === (identity.seasonNumber ?? 0) &&
        id.episodeNumber === (identity.episodeNumber ?? 0)
      );
    }
    return id.mediaType === "movie" || id.mediaType === identity.mediaType;
  });
}

export type TitleDownloadState =
  | { kind: "download"; label: string }
  | { kind: "downloading"; label: string; progress: number | null }
  | { kind: "downloaded"; label: string };

/**
 * Secondary "Cache" pill for titles that already stream on demand: saves the IPTV
 * source to the local cache and reports the job's progress. Series pages download per episode.
 */
export function useTitleDownload(media: Media | null | undefined) {
  const qc = useQueryClient();
  const demo = useIsDemoUser();
  const iptv = media?.availability.find((a) => a.provider === "dispatcharr");
  const cache = media?.availability.find((a) => a.provider === "cache");
  const jellyfin = media?.availability.find((a) => a.provider === "jellyfin");
  const kind = media?.identity.mediaType;
  const eligible = Boolean(
    media &&
      !demo &&
      (kind === "movie" || kind === "episode") &&
      iptv?.provider === "dispatcharr" &&
      iptv.uuid &&
      !(jellyfin?.provider === "jellyfin" && jellyfin.canPlay),
  );

  const acquisitions = useQuery({
    queryKey: ["acquisitions"],
    queryFn: () => listAcquisitions(),
    enabled: eligible,
    refetchInterval: (result) =>
      (result.state.data?.items ?? []).some((item) =>
        (ACTIVE_STATES as readonly string[]).includes(item.state),
      )
        ? 1500
        : false,
  });

  const start = useMutation({
    mutationFn: async () => {
      if (!media || iptv?.provider !== "dispatcharr" || !iptv.uuid) {
        throw new Error("No on-demand source to cache");
      }
      await startAcquisition({
        identity: media.identity,
        mode: "cache",
        source: {
          provider: "dispatcharr",
          uuid: iptv.uuid,
          episodeId: iptv.episodeId,
          movieId: iptv.movieId,
          streamId: iptv.candidates[0]?.streamId,
          m3uAccountId: iptv.candidates[0]?.m3uAccountId,
        },
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["acquisitions"] }),
  });

  let state: TitleDownloadState | null = null;
  if (eligible && media) {
    const job = matchAcquisition(acquisitions.data?.items, media.identity);
    const cacheComplete = cache?.provider === "cache" && cache.complete;
    if (job?.state === "completed" || (!job && cacheComplete)) {
      state = { kind: "downloaded", label: "Cached" };
    } else if (start.isPending || (job && (ACTIVE_STATES as readonly string[]).includes(job.state))) {
      const progress = job ? acquisitionProgressPercent(job) : null;
      state = {
        kind: "downloading",
        label: progress != null ? `Caching ${progress}%` : "Caching…",
        progress,
      };
    } else {
      state = { kind: "download", label: "Cache" };
    }
  }

  return {
    state,
    /** Eligible, but existing download jobs haven't loaded, so `state` may still change. */
    loading: eligible && acquisitions.isPending,
    pending: start.isPending,
    start: () => {
      if (state?.kind === "download" && !start.isPending) start.mutate();
    },
    error: start.error,
  };
}
