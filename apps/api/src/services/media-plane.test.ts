import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { hlsAccelPath, nginxServesProvider, safeProxiedContentType, upstreamAccelPath } from "./media-plane.js";

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

describe("nginxServesProvider", () => {
  const config = loadConfig({ RECLINARR_MEDIA_PLANE: "nginx", JELLYFIN_URL: "https://jf.example/jellyfin" });

  it("hands media to nginx only while its rendered upstream matches the current config", () => {
    expect(nginxServesProvider(config, "jellyfin", { RECLINARR_NGINX_JELLYFIN_UPSTREAM: "https://jf.example" })).toBe(true);
    expect(nginxServesProvider(config, "jellyfin", { RECLINARR_NGINX_JELLYFIN_UPSTREAM: "https://old.example" })).toBe(false);
  });

  it("never uses nginx on the node plane", () => {
    expect(nginxServesProvider(loadConfig({ JELLYFIN_URL: "https://jf.example" }), "jellyfin", {})).toBe(false);
  });
});

describe("safeProxiedContentType", () => {
  it("keeps raster images and media, downgrades anything a browser could run", () => {
    expect(safeProxiedContentType("image/png", "image")).toBe("image/png");
    expect(safeProxiedContentType("video/mp4", "media")).toBe("video/mp4");
    expect(safeProxiedContentType("application/x-mpegURL", "media")).toBe("application/x-mpegURL");
    expect(safeProxiedContentType("video/mp4", "image")).toBe("application/octet-stream");
    for (const active of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml; charset=utf-8", null]) {
      expect(safeProxiedContentType(active, "media"), String(active)).toBe("application/octet-stream");
    }
  });
});
