import { describe, expect, it } from "vitest";
import { isPlaylistPath, MAX_PLAYLIST_BYTES, readPlaylistText } from "./playback.js";

describe("Jellyfin proxy playlist handling", () => {
  it("only treats the path, not the query, as naming a playlist", () => {
    expect(isPlaylistPath("/videos/abc/master.m3u8?api_key=x")).toBe(true);
    expect(isPlaylistPath("/Videos/abc/stream?static=true&x=.m3u8")).toBe(false);
    expect(isPlaylistPath("x.m3u8#frag")).toBe(true);
  });

  it("reads a normal playlist", async () => {
    const abort = new AbortController();
    const text = await readPlaylistText(new Response("#EXTM3U\n#EXTINF:6,\nseg0.ts\n"), abort);
    expect(text).toContain("seg0.ts");
    expect(abort.signal.aborted).toBe(false);
  });

  it("refuses and aborts a body larger than any playlist", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const abort = new AbortController();
    await expect(readPlaylistText(new Response(body), abort)).rejects.toMatchObject({ statusCode: 502 });
    expect(abort.signal.aborted).toBe(true);
    expect(sent).toBeLessThan(MAX_PLAYLIST_BYTES + 3 * chunk.byteLength);
  });

  it("refuses up front when the declared length is too large", async () => {
    const abort = new AbortController();
    const res = new Response("x", { headers: { "content-length": String(MAX_PLAYLIST_BYTES + 1) } });
    await expect(readPlaylistText(res, abort)).rejects.toMatchObject({ statusCode: 502 });
  });
});
