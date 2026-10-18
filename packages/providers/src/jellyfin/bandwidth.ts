/** Fallback when a probe fails or returns nonsense. */
export const DEFAULT_STREAMING_BITRATE = 8_000_000;
export const MIN_STREAMING_BITRATE = 2_000_000;
export const MAX_STREAMING_BITRATE = 20_000_000;

/** Bytes to pull during a throughput probe (~1.5 MiB). */
export const BANDWIDTH_PROBE_BYTES = 1_500_000;

/** Keep headroom for TCP ramp-up, concurrent fragment fetches, and jitter. */
export const BANDWIDTH_PROBE_HEADROOM = 0.65;

export function clampStreamingBitrate(bps: number): number {
  if (!Number.isFinite(bps) || bps <= 0) return DEFAULT_STREAMING_BITRATE;
  return Math.min(
    MAX_STREAMING_BITRATE,
    Math.max(MIN_STREAMING_BITRATE, Math.floor(bps)),
  );
}

/**
 * Convert a timed download into a usable MaxStreamingBitrate.
 * Applies headroom so playlist BANDWIDTH stays under measured throughput.
 */
export function bitrateFromProbe(bytes: number, seconds: number): number {
  if (!Number.isFinite(bytes) || bytes < 32_000) return DEFAULT_STREAMING_BITRATE;
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_STREAMING_BITRATE;
  const rawBps = (bytes * 8) / seconds;
  return clampStreamingBitrate(rawBps * BANDWIDTH_PROBE_HEADROOM);
}

export function bandwidthProbeRangeHeader(
  bytes: number = BANDWIDTH_PROBE_BYTES,
): string {
  return `bytes=0-${Math.max(0, bytes - 1)}`;
}
