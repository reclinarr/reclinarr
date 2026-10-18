import { describe, expect, it } from "vitest";
import {
  buildOutputArgs,
  isBrowserSafeAudioCodec,
  isStreamCopyableAudioCodec,
  remuxModeHeader,
} from "./ffmpeg-remux.js";

describe("isBrowserSafeAudioCodec", () => {
  it("accepts common browser codecs", () => {
    expect(isBrowserSafeAudioCodec("aac")).toBe(true);
    expect(isBrowserSafeAudioCodec("mp3")).toBe(true);
    expect(isBrowserSafeAudioCodec("opus")).toBe(true);
    expect(isBrowserSafeAudioCodec("mp4a")).toBe(true);
    expect(isBrowserSafeAudioCodec("AAC")).toBe(true);
  });

  it("rejects AC3/DTS/TrueHD/FLAC", () => {
    expect(isBrowserSafeAudioCodec("ac3")).toBe(false);
    expect(isBrowserSafeAudioCodec("eac3")).toBe(false);
    expect(isBrowserSafeAudioCodec("dts")).toBe(false);
    expect(isBrowserSafeAudioCodec("truehd")).toBe(false);
    expect(isBrowserSafeAudioCodec("flac")).toBe(false);
  });

  it("rejects empty", () => {
    expect(isBrowserSafeAudioCodec(undefined)).toBe(false);
    expect(isBrowserSafeAudioCodec("")).toBe(false);
  });
});

describe("buildOutputArgs", () => {
  it("stream-copies audio when copyAudio is true", () => {
    const args = buildOutputArgs(true, { audioCodec: "aac", formatName: "matroska,webm" });
    expect(args).toContain("-c:a");
    expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
    expect(args).not.toContain("192k");
    expect(args).not.toContain("aac_adtstoasc");
  });

  it("adds aac_adtstoasc when copying AAC from MPEG-TS", () => {
    const args = buildOutputArgs(true, { audioCodec: "aac", formatName: "mpegts" });
    expect(args).toEqual(expect.arrayContaining(["-bsf:a", "aac_adtstoasc"]));
  });

  it("re-encodes to AAC when copyAudio is false", () => {
    const args = buildOutputArgs(false);
    expect(args).toEqual(
      expect.arrayContaining(["-c:a", "aac", "-ac", "2", "-b:a", "192k"]),
    );
  });

  it("always copies video and emits fragmented MP4", () => {
    for (const copy of [true, false]) {
      const args = buildOutputArgs(copy);
      expect(args).toEqual(
        expect.arrayContaining([
          "-c:v",
          "copy",
          "-movflags",
          "frag_keyframe+empty_moov+default_base_moof",
          "-f",
          "mp4",
        ]),
      );
    }
  });
});

describe("isStreamCopyableAudioCodec", () => {
  it("allows aac/mp3 only for fMP4 copy", () => {
    expect(isStreamCopyableAudioCodec("aac")).toBe(true);
    expect(isStreamCopyableAudioCodec("mp3")).toBe(true);
    expect(isStreamCopyableAudioCodec("opus")).toBe(false);
    expect(isStreamCopyableAudioCodec("ac3")).toBe(false);
  });
});

describe("remuxModeHeader", () => {
  it("labels copy vs encode", () => {
    expect(remuxModeHeader(true)).toBe("copy-mp4");
    expect(remuxModeHeader(false)).toBe("aac-mp4");
  });
});
