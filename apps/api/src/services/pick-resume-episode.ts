export type ResumeEpisodeCandidate = {
  seasonNumber: number;
  episodeNumber: number;
  positionSeconds: number;
  durationSeconds?: number;
  /** Epoch ms — newer wins. */
  updatedAtMs: number;
};

/**
 * Pick the most recently watched in-progress episode.
 * Avoids ascending S/E order (which wrongly prefers S1:E9 over S4:E1).
 */
export function pickResumeEpisode(
  candidates: ResumeEpisodeCandidate[],
): Omit<ResumeEpisodeCandidate, "updatedAtMs"> | null {
  const eligible = candidates.filter(
    (c) =>
      Number.isFinite(c.seasonNumber) &&
      Number.isFinite(c.episodeNumber) &&
      c.positionSeconds > 30,
  );
  if (!eligible.length) return null;
  eligible.sort(
    (a, b) =>
      b.updatedAtMs - a.updatedAtMs ||
      b.seasonNumber - a.seasonNumber ||
      b.episodeNumber - a.episodeNumber,
  );
  const top = eligible[0]!;
  return {
    seasonNumber: top.seasonNumber,
    episodeNumber: top.episodeNumber,
    positionSeconds: top.positionSeconds,
    ...(top.durationSeconds != null ? { durationSeconds: top.durationSeconds } : {}),
  };
}
