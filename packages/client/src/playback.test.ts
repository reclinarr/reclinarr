import { describe, expect, it } from "vitest";
import type { PlaybackSource } from "@reclinarr/shared";
import { classifyPlayback, sessionCookieHeader } from "./playback.js";

function source(partial: {
  url: string;
  mimeType?: string;
  hls?: boolean;
  playMethod?: PlaybackSource["playMethod"];
}): PlaybackSource {
  return {
    provider: "jellyfin",
    delivery: { mode: "proxy", url: partial.url },
    directPlay: true,
    hls: partial.hls,
    mimeType: partial.mimeType,
    playMethod: partial.playMethod,
  };
}

describe("classifyPlayback", () => {
  it("classifies live MPEG-TS", () => {
    expect(
      classifyPlayback(
        source({
          url: "/api/playback/dispatcharr/live/00000000-0000-0000-0000-000000000001",
          mimeType: "video/mp2t",
        }),
      ),
    ).toBe("mpegts");
  });

  it("classifies live HLS remux", () => {
    expect(
      classifyPlayback(
        source({
          url: "/api/playback/dispatcharr/live/00000000-0000-0000-0000-000000000001/hls/index.m3u8",
          hls: true,
          mimeType: "application/vnd.apple.mpegurl",
        }),
      ),
    ).toBe("hls");
  });

  it("classifies HLS playlists", () => {
    expect(classifyPlayback(source({ url: "/api/playback/cache/1/hls/index.m3u8", hls: true }))).toBe(
      "hls",
    );
  });

  it("classifies progressive files", () => {
    expect(classifyPlayback(source({ url: "/api/playback/jellyfin/stream", mimeType: "video/mp4" }))).toBe(
      "progressive",
    );
  });
});

describe("sessionCookieHeader", () => {
  it("includes Cookie and a fetch-safe session header outside React Native", () => {
    const prev = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { product: "Gecko" },
      configurable: true,
    });
    try {
      expect(sessionCookieHeader("abc")).toEqual({
        Cookie: "streamerr_session=abc",
        "x-streamerr-session": "abc",
      });
      expect(sessionCookieHeader(null)).toEqual({});
    } finally {
      Object.defineProperty(globalThis, "navigator", { value: prev, configurable: true });
    }
  });

  it("omits Cookie on React Native", () => {
    const prev = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { product: "ReactNative" },
      configurable: true,
    });
    try {
      expect(sessionCookieHeader("abc")).toEqual({
        "x-streamerr-session": "abc",
      });
    } finally {
      Object.defineProperty(globalThis, "navigator", { value: prev, configurable: true });
    }
  });
});
