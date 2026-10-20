import { describe, expect, it } from "vitest";
import {
  isLocalPlaybackHost,
  normalizeCacheHlsPlaylist,
  normalizePublicOrigin,
  requestPublicOrigin,
  resolveJellyfinUri,
  rewriteHlsPlaylist,
  toHlsProxyUrl,
} from "./jellyfin-hls-rewrite.js";

describe("rewriteHlsPlaylist", () => {
  it("preserves ENDLIST and other non-URI tags (full VOD)", () => {
    const input = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:6",
      "#EXT-X-PLAYLIST-TYPE:VOD",
      "#EXTINF:6.000,",
      "seg0.ts",
      "#EXTINF:6.000,",
      "seg1.ts",
      "#EXT-X-ENDLIST",
      "",
    ].join("\n");

    const out = rewriteHlsPlaylist(input, {
      transcodingPath: "/Videos/abc/master.m3u8?MediaSourceId=1",
    });

    expect(out).toContain("#EXT-X-ENDLIST");
    expect(out).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    expect(out).toContain(
      toHlsProxyUrl("/Videos/abc/seg0.ts"),
    );
    expect(out).toContain(
      toHlsProxyUrl("/Videos/abc/seg1.ts"),
    );
  });

  it("embeds session id on proxy URLs for native HLS auth", () => {
    const out = rewriteHlsPlaylist("#EXTM3U\nseg0.ts\n", {
      path: "/Videos/abc/master.m3u8",
      sessionId: "sess-1",
    });
    expect(out).toContain(toHlsProxyUrl("/Videos/abc/seg0.ts", "sess-1"));
    expect(out).toContain("streamerr_session=sess-1");
  });

  it("rewrites URI= attributes on stream-inf / media tags", () => {
    const input = [
      "#EXTM3U",
      '#EXT-X-STREAM-INF:BANDWIDTH=8000000',
      "main.m3u8?VideoCodec=h264",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="eng",URI="audio.m3u8"',
    ].join("\n");

    const out = rewriteHlsPlaylist(input, {
      path: "/Videos/abc/master.m3u8",
    });

    expect(out).toContain(
      toHlsProxyUrl("/Videos/abc/main.m3u8?VideoCodec=h264"),
    );
    expect(out).toContain(
      `URI="${toHlsProxyUrl("/Videos/abc/audio.m3u8")}"`,
    );
  });

  it("keeps absolute same-host paths and query strings", () => {
    expect(resolveJellyfinUri("/Videos/x/hls1/seg.ts?api_key=tok", "/")).toBe(
      "/Videos/x/hls1/seg.ts?api_key=tok",
    );
    expect(
      resolveJellyfinUri("https://jellyfin.example/Videos/x/seg.ts?q=1", "/ignored/"),
    ).toBe("/Videos/x/seg.ts?q=1");
  });

  it("forces https for public hosts so iOS ATS can load HLS segments", () => {
    expect(isLocalPlaybackHost("localhost")).toBe(true);
    expect(isLocalPlaybackHost("192.168.1.20")).toBe(true);
    expect(isLocalPlaybackHost("streamerr.faraone.ovh")).toBe(false);
    expect(normalizePublicOrigin("http://streamerr.faraone.ovh")).toBe(
      "https://streamerr.faraone.ovh",
    );
    expect(normalizePublicOrigin("http://192.168.1.20:8787")).toBe(
      "http://192.168.1.20:8787",
    );
    expect(
      requestPublicOrigin(
        { protocol: "http", headers: { host: "streamerr.faraone.ovh" } },
      ),
    ).toBe("https://streamerr.faraone.ovh");
    expect(
      requestPublicOrigin(
        { protocol: "http", headers: { host: "localhost:8787" } },
        "https://streamerr.faraone.ovh",
      ),
    ).toBe("https://streamerr.faraone.ovh");
  });

  it("emits https absolute segment URLs for public origins", () => {
    const out = rewriteHlsPlaylist("#EXTM3U\nseg0.ts\n", {
      path: "/Videos/abc/master.m3u8",
      sessionId: "sess-1",
      publicOrigin: normalizePublicOrigin("http://streamerr.faraone.ovh"),
    });
    expect(out).toContain(
      "https://streamerr.faraone.ovh/api/playback/jellyfin/hls?path=",
    );
    expect(out).not.toContain("http://streamerr.faraone.ovh/");
  });
});

describe("normalizeCacheHlsPlaylist", () => {
  it("forces MEDIA-SEQUENCE 0 and EXT-X-START at 0", () => {
    const input = [
      "#EXTM3U",
      "#EXT-X-VERSION:6",
      "#EXT-X-TARGETDURATION:4",
      "#EXT-X-MEDIA-SEQUENCE:800",
      "#EXTINF:4.0,",
      "seg_00000.ts",
      "",
    ].join("\n");
    const out = normalizeCacheHlsPlaylist(input);
    expect(out).toContain("#EXT-X-MEDIA-SEQUENCE:0");
    expect(out).not.toContain("#EXT-X-MEDIA-SEQUENCE:800");
    expect(out).toContain("#EXT-X-START:TIME-OFFSET=0,PRECISE=YES");
  });
});
