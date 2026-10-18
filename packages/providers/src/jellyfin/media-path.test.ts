import { describe, expect, it } from "vitest";
import {
  isJellyfinMediaPath,
  normalizeJellyfinRelativePath,
} from "./provider.js";

const BASE = "http://jellyfin:8096";

describe("normalizeJellyfinRelativePath", () => {
  it("keeps relative media paths", () => {
    expect(normalizeJellyfinRelativePath("/Videos/abc/stream.m3u8", BASE)).toBe(
      "/Videos/abc/stream.m3u8",
    );
    expect(normalizeJellyfinRelativePath("Videos/abc/master.m3u8?foo=1", BASE)).toBe(
      "/Videos/abc/master.m3u8?foo=1",
    );
  });

  it("allows same-origin absolute URLs as relative paths", () => {
    expect(
      normalizeJellyfinRelativePath("http://jellyfin:8096/Videos/x/hls1/seg.ts", BASE),
    ).toBe("/Videos/x/hls1/seg.ts");
  });

  it("rejects off-host absolute URLs", () => {
    expect(normalizeJellyfinRelativePath("http://evil.example/steal", BASE)).toBeNull();
    expect(
      normalizeJellyfinRelativePath("https://169.254.169.254/latest/meta", BASE),
    ).toBeNull();
  });

  it("rejects path traversal and opaque schemes", () => {
    expect(normalizeJellyfinRelativePath("/Videos/../Users", BASE)).toBeNull();
    expect(normalizeJellyfinRelativePath("ftp://jellyfin:8096/Videos/x", BASE)).toBeNull();
  });
});

describe("isJellyfinMediaPath", () => {
  it("allows video/hls paths", () => {
    expect(isJellyfinMediaPath("/Videos/abc/stream.m3u8")).toBe(true);
    expect(isJellyfinMediaPath("/videos/abc/hls1/main.ts")).toBe(true);
    expect(isJellyfinMediaPath("/Audio/abc/stream.mp3")).toBe(true);
  });

  it("rejects general API paths", () => {
    expect(isJellyfinMediaPath("/Users")).toBe(false);
    expect(isJellyfinMediaPath("/Items/abc")).toBe(false);
    expect(isJellyfinMediaPath("/System/Info")).toBe(false);
  });
});
