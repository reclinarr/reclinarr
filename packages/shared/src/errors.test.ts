import { describe, expect, it } from "vitest";
import {
  IPTV_STREAM_BUSY_MESSAGE,
  formatIptvUpstreamError,
  formatPlaybackIoError,
  isIptvConnectionLimitError,
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
});
