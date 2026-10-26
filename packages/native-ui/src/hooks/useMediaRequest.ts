import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { resolvePreferredAction, type Media } from "@reclinarr/shared";
import { me, mediaByTmdb, primaryAction, requestMedia } from "@reclinarr/client";

const DOWNLOAD_POLL_MS = 4_000;
const APPROVAL_POLL_MS = 5_000;

/** Demo accounts (store review) can't request titles or start IPTV downloads; the API refuses both. */
export function useIsDemoUser(): boolean {
  const session = useQuery({ queryKey: ["me"], queryFn: () => me() });
  return session.data?.user.demo === true;
}

/** Overlay fresh Seerr/Jellyfin state onto `base` without dropping its IPTV/cache entries. */
function withLiveRequestState(base: Media, live: Media | undefined): Media {
  if (!live) return base;
  const seerr = live.availability.find((a) => a.provider === "seerr");
  const jellyfin = live.availability.find((a) => a.provider === "jellyfin" && a.canPlay);
  const availability = [
    ...base.availability.filter(
      (a) => !(seerr && a.provider === "seerr") && !(jellyfin && a.provider === "jellyfin"),
    ),
    ...(jellyfin ? [jellyfin] : []),
    ...(seerr ? [seerr] : []),
  ];
  return { ...base, availability, preferredAction: resolvePreferredAction(availability) };
}

/**
 * Seerr request flow for one title: `request()` submits it, then the title is polled
 * so the primary button moves Request → Requested → Downloading n% → Play in place.
 */
export function useMediaRequest(media: Media | null | undefined) {
  const qc = useQueryClient();
  const demo = useIsDemoUser();
  const type = media?.identity.mediaType;
  const tmdbId = media?.identity.tmdbId;
  const target =
    (type === "movie" || type === "tv") && typeof tmdbId === "number" ? { type, tmdbId } : null;
  const [tracking, setTracking] = useState(false);
  const baseKind = media ? primaryAction(media).kind : null;

  const live = useQuery({
    queryKey: ["media", target?.type, target?.tmdbId],
    queryFn: () => mediaByTmdb(target!.type, target!.tmdbId),
    enabled: Boolean(target && (tracking || baseKind === "requested" || baseKind === "downloading")),
    refetchInterval: (q) => {
      const liveMedia = q.state.data?.media;
      const kind = liveMedia ? primaryAction(liveMedia).kind : baseKind;
      if (kind === "downloading") return DOWNLOAD_POLL_MS;
      if (kind === "requested") return APPROVAL_POLL_MS;
      return false;
    },
  });

  const submit = useMutation({
    mutationFn: () => requestMedia(media!.identity),
    onSuccess: () => {
      setTracking(true);
      if (target) void qc.invalidateQueries({ queryKey: ["media", target.type, target.tmdbId] });
      void qc.invalidateQueries({ queryKey: ["requests"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
    },
  });

  const effective = useMemo(
    () => (media ? withLiveRequestState(media, live.data?.media) : media),
    [media, live.data?.media],
  );
  const baseAction = effective
    ? submit.isPending
      ? { ...primaryAction(effective), kind: "requested" as const, label: "Requesting…" }
      : primaryAction(effective)
    : null;
  const action =
    demo && effective && baseAction?.kind !== "play"
      ? { kind: "none" as const, label: "Not available", progress: null, hint: "" }
      : baseAction;

  return {
    media: effective,
    action,
    request: () => {
      if (target && !demo && !submit.isPending) submit.mutate();
    },
    pending: submit.isPending,
    error: submit.error,
  };
}
