import { describe, expect, it } from "vitest";
import { JellyfinProvider } from "./provider.js";

describe("native playback negotiation", () => {
  it.each(["ios", "android"] as const)("negotiates HLS for MKV on %s", async (deviceProfile) => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/PlaybackInfo")) {
        const request = JSON.parse(String(init?.body));
        const profiles = request.DeviceProfile.DirectPlayProfiles as Array<{
          Container: string;
          AudioCodec: string;
        }>;
        expect(profiles.some((profile) => profile.Container.split(",").includes("mkv"))).toBe(false);
        expect(profiles.some((profile) => profile.AudioCodec.split(",").includes("truehd"))).toBe(false);
        return Response.json({
          MediaSources: [{
            Id: "source",
            Container: "mkv",
            SupportsDirectPlay: false,
            SupportsTranscoding: true,
            TranscodingSubProtocol: "hls",
            TranscodingUrl: "/Videos/item/master.m3u8?StartTimeTicks=100",
          }],
        });
      }
      if (url.pathname.includes("/Items/")) {
        return Response.json({ Id: "item", Type: "Movie", Path: "/media/movie.mkv" });
      }
      return new Response(new Uint8Array(1024), { status: 206 });
    };
    const provider = new JellyfinProvider({ baseUrl: "https://jellyfin.example", fetchImpl });
    const source = await provider.resolvePlayback({
      jellyfinUserId: "user",
      jellyfinAccessToken: "token",
      deviceId: "device",
      deviceName: "test",
    }, { mediaType: "movie", jellyfinItemId: "item" }, { deviceProfile });

    expect(source).toMatchObject({ playMethod: "Transcode", hls: true, mimeType: "application/vnd.apple.mpegurl" });
    expect(source?.delivery.url).not.toContain("StartTimeTicks");
  });

  it("asks Jellyfin for the preferred audio language when it is not the default", async () => {
    const requested: Array<number | undefined> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/PlaybackInfo")) {
        const request = JSON.parse(String(init?.body)) as { AudioStreamIndex?: number };
        requested.push(request.AudioStreamIndex);
        return Response.json({
          MediaSources: [{
            Id: "source",
            Container: "mkv",
            SupportsDirectPlay: false,
            SupportsTranscoding: true,
            TranscodingSubProtocol: "hls",
            TranscodingUrl: "/Videos/item/master.m3u8",
            DefaultAudioStreamIndex: 1,
            MediaStreams: [
              { Type: "Audio", Index: 1, Language: "eng" },
              { Type: "Audio", Index: 2, Language: "ita" },
            ],
          }],
        });
      }
      if (url.pathname.includes("/Items/")) {
        return Response.json({ Id: "item", Type: "Movie", Path: "/media/movie.mkv" });
      }
      return new Response(new Uint8Array(1024), { status: 206 });
    };
    const provider = new JellyfinProvider({ baseUrl: "https://jellyfin.example", fetchImpl });
    const source = await provider.resolvePlayback(
      {
        jellyfinUserId: "user",
        jellyfinAccessToken: "token",
        deviceId: "device",
        deviceName: "test",
      },
      { mediaType: "movie", jellyfinItemId: "item" },
      { preferredAudioLanguage: "it" },
    );

    expect(requested).toEqual([undefined, 2]);
    expect(source?.delivery.url).toContain("audioStreamIndex=2");
  });
});
