/**
 * Cap how far the scrubber may seek for in-progress IPTV cache downloads.
 * Jellyfin (and any non-cache) VOD is fully seekable — never apply the 5%
 * download headroom fallback (that snapped 2h movies to ~7 minutes).
 */
export function maxSeekableSecondsForSource(opts: {
  provider?: string;
  downloadComplete: boolean;
  downloadBytes: number;
  downloadTotal?: number;
  knownDuration: number;
}): number {
  const { knownDuration } = opts;
  if (opts.provider !== "cache") {
    return knownDuration > 0 ? knownDuration : Infinity;
  }
  if (opts.downloadComplete || knownDuration <= 0) {
    return knownDuration > 0 ? knownDuration : Infinity;
  }
  if (opts.downloadTotal && opts.downloadTotal > 0 && opts.downloadBytes > 0) {
    return Math.max(0, (opts.downloadBytes / opts.downloadTotal) * knownDuration - 8);
  }
  return Math.max(30, knownDuration * 0.05);
}
