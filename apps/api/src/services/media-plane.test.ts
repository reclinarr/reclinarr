import { describe, expect, it } from "vitest";
import { hlsAccelPath, upstreamAccelPath } from "./media-plane.js";

describe("upstreamAccelPath", () => {
  it("maps jellyfin URL onto internal location", () => {
    expect(
      upstreamAccelPath(
        "jellyfin",
        "http://jellyfin:8096/Videos/abc/stream?static=true&api_key=secret",
      ),
    ).toBe("/_upstream/jellyfin/Videos/abc/stream?static=true&api_key=secret");
  });

  it("maps dispatcharr live URL", () => {
    expect(
      upstreamAccelPath(
        "dispatcharr",
        "http://dispatcharr:9191/proxy/ts/stream/11111111-1111-1111-1111-111111111111?token=jwt",
      ),
    ).toContain("/_upstream/dispatcharr/proxy/ts/stream/");
  });
});

describe("hlsAccelPath", () => {
  it("keeps uuid unescaped for alias mapping", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(hlsAccelPath(id, "index.m3u8")).toBe(`/_hls/${id}/index.m3u8`);
    expect(hlsAccelPath(id, "../etc/passwd")).toBe(`/_hls/${id}/etc/passwd`);
  });
});
