import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Media } from "@reclinarr/shared";
import { resolvePlaybackForPlay } from "@reclinarr/client";
import type { PlayNavParams, ScreenNav } from "../screens/types.js";

export function usePlayMedia(nav: Pick<ScreenNav, "openPlayer" | "openDetails">) {
  const [bufferStatus, setBufferStatus] = useState<string | null>(null);

  const playMedia = useMutation({
    mutationFn: (media: Media) =>
      resolvePlaybackForPlay(media.identity, {
        meta: media.metadata,
        onBuffering: ({ bytesDownloaded = 0, totalBytes }) => {
          if (totalBytes && totalBytes > 0) {
            setBufferStatus(
              `Buffering… ${Math.min(99, Math.round((bytesDownloaded / totalBytes) * 100))}%`,
            );
          } else {
            setBufferStatus(`Buffering… ${Math.round(bytesDownloaded / 1_000_000)} MB`);
          }
        },
      }).then((source) => ({ source, media })),
    onSuccess: ({ source, media }) => {
      setBufferStatus(null);
      const params: PlayNavParams = {
        source,
        title: media.metadata.title,
        identity: source.resolvedIdentity ?? media.identity,
      };
      nav.openPlayer(params);
    },
    onError: (_err, media) => {
      setBufferStatus(null);
      const { jellyfinItemId, tmdbId, mediaType } = media.identity;
      if (tmdbId && (mediaType === "movie" || mediaType === "tv")) {
        nav.openDetails({ type: mediaType, tmdbId });
      } else if (jellyfinItemId) {
        nav.openDetails({ jellyfinItemId });
      }
    },
  });

  return { playMedia, bufferStatus, setBufferStatus };
}
