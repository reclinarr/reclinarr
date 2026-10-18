import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import { hlsPlaybackReady, hlsFinalized, removeHlsDir } from "./hls-paths.js";

describe("hlsPlaybackReady", () => {
  const root = join(tmpdir(), `reclinarr-hls-${Date.now()}`);
  const id = "11111111-1111-1111-1111-111111111111";

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("is false when playlist missing", () => {
    expect(hlsPlaybackReady(root, id)).toBe(false);
  });

  it("is true when playlist has EXTINF", () => {
    const dir = join(root, "hls", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "index.m3u8"),
      "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nseg_00000.ts\n",
    );
    expect(hlsPlaybackReady(root, id)).toBe(true);
    expect(hlsFinalized(root, id)).toBe(false);
  });

  it("detects ENDLIST and removeHlsDir", () => {
    const dir = join(root, "hls", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "index.m3u8"),
      "#EXTM3U\n#EXTINF:4.0,\nseg_00000.ts\n#EXT-X-ENDLIST\n",
    );
    expect(hlsFinalized(root, id)).toBe(true);
    removeHlsDir(root, id);
    expect(hlsPlaybackReady(root, id)).toBe(false);
  });
});
