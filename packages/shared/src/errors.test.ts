import { describe, expect, it } from "vitest";
import {
  IPTV_STREAM_BUSY_MESSAGE,
  formatIptvUpstreamError,
  formatPlaybackIoError,
  isBehindLiveWindowError,
  isIptvConnectionLimitError,
  isNonRecoverableLiveError,
} from "./errors.js";

describe("isIptvConnectionLimitError", () => {
  it("detects Dispatcharr max-connection JSON", () => {
    expect(
      isIptvConnectionLimitError(
        503,
        '{"error": "All active M3U profiles have reached maximum connection limits", "waited": "3s"}',
      ),
    ).toBe(true);
  });

  it("treats bare 503 as busy", () => {
    expect(isIptvConnectionLimitError(503)).toBe(true);
  });

  it("treats empty 502 as busy (nginx hiding upstream body)", () => {
    expect(isIptvConnectionLimitError(502, "")).toBe(true);
    expect(isIptvConnectionLimitError(502, "gateway timeout from somewhere else")).toBe(false);
  });
});

describe("formatIptvUpstreamError", () => {
  it("returns the busy message for connection limits", () => {
    expect(
      formatIptvUpstreamError(
        503,
        "All active M3U profiles have reached maximum connection limits",
      ),
    ).toBe(IPTV_STREAM_BUSY_MESSAGE);
  });

  it("returns null for unrelated errors", () => {
    expect(formatIptvUpstreamError(404, "Not found")).toBeNull();
  });
});

describe("formatPlaybackIoError", () => {
  it("maps mpegts 502 loader errors", () => {
    expect(formatPlaybackIoError({ code: 502, msg: "" })).toBe(IPTV_STREAM_BUSY_MESSAGE);
    expect(
      formatPlaybackIoError({
        code: 502,
        msg: "IOException: type = HttpStatusCodeInvalid, code = 502, msg =",
      }),
    ).toBe(IPTV_STREAM_BUSY_MESSAGE);
  });

  it("does not map behind-live-window (native recovers)", () => {
    expect(
      formatPlaybackIoError({
        msg: "ExoPlaybackException: ERROR_CODE_BEHIND_LIVE_WINDOW",
      }),
    ).toBeNull();
  });
});

describe("isBehindLiveWindowError", () => {
  it("matches ExoPlayer / rn-video strings and codes", () => {
    expect(
      isBehindLiveWindowError("ExoPlaybackException: ERROR_CODE_BEHIND_LIVE_WINDOW"),
    ).toBe(true);
    expect(isBehindLiveWindowError(null, 1002)).toBe(true);
    expect(isBehindLiveWindowError(null, "21002")).toBe(true);
    expect(isBehindLiveWindowError("decoder init failed")).toBe(false);
  });
});

describe("isNonRecoverableLiveError", () => {
  it("treats IPTV slot conflicts as non-recoverable", () => {
    expect(isNonRecoverableLiveError(IPTV_STREAM_BUSY_MESSAGE)).toBe(true);
    expect(isNonRecoverableLiveError("IPTV connection limit reached")).toBe(true);
  });

  it("allows transient stream failures to retry", () => {
    expect(isNonRecoverableLiveError("HLS error")).toBe(false);
    expect(isNonRecoverableLiveError("Playback failed")).toBe(false);
  });
});
