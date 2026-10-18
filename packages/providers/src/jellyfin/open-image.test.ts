import { describe, expect, it } from "vitest";
import { JellyfinProvider } from "./provider.js";

describe("JellyfinProvider.openImage", () => {
  it("forwards a resize to Jellyfin so clients can avoid full-size backdrops", async () => {
    let requested = "";
    const fetchImpl: typeof fetch = async (input) => {
      requested = String(input);
      return new Response(new Uint8Array([0xff, 0xd8]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    };
    const provider = new JellyfinProvider({
      baseUrl: "https://jellyfin.example",
      fetchImpl,
    });

    await provider.openImage(
      {
        jellyfinUserId: "user",
        jellyfinAccessToken: "token",
        deviceId: "device-1",
        deviceName: "tv",
      },
      "item id",
      "Backdrop",
      { maxWidth: 640, quality: 80 },
    );

    const url = new URL(requested);
    expect(url.pathname).toBe("/Items/item%20id/Images/Backdrop");
    expect(url.searchParams.get("maxWidth")).toBe("640");
    expect(url.searchParams.get("quality")).toBe("80");
  });
});
