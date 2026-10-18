import { describe, expect, it } from "vitest";
import {
  BANDWIDTH_PROBE_HEADROOM,
  DEFAULT_STREAMING_BITRATE,
  MAX_STREAMING_BITRATE,
  MIN_STREAMING_BITRATE,
  bitrateFromProbe,
  clampStreamingBitrate,
} from "./bandwidth.js";

describe("clampStreamingBitrate", () => {
  it("falls back for invalid values", () => {
    expect(clampStreamingBitrate(Number.NaN)).toBe(DEFAULT_STREAMING_BITRATE);
    expect(clampStreamingBitrate(0)).toBe(DEFAULT_STREAMING_BITRATE);
    expect(clampStreamingBitrate(-1)).toBe(DEFAULT_STREAMING_BITRATE);
  });

  it("clamps to min/max", () => {
    expect(clampStreamingBitrate(500_000)).toBe(MIN_STREAMING_BITRATE);
    expect(clampStreamingBitrate(50_000_000)).toBe(MAX_STREAMING_BITRATE);
    expect(clampStreamingBitrate(7_500_000)).toBe(7_500_000);
  });
});

describe("bitrateFromProbe", () => {
  it("applies headroom to measured throughput", () => {
    // 1_500_000 bytes in 1s → 12 Mbps raw → *0.65
    const expected = Math.floor(12_000_000 * BANDWIDTH_PROBE_HEADROOM);
    expect(bitrateFromProbe(1_500_000, 1)).toBe(expected);
  });

  it("falls back when the sample is too small or timed poorly", () => {
    expect(bitrateFromProbe(100, 1)).toBe(DEFAULT_STREAMING_BITRATE);
    expect(bitrateFromProbe(1_500_000, 0)).toBe(DEFAULT_STREAMING_BITRATE);
  });
});
