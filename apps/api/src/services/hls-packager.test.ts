import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { playlistNeedsRebuild } from "./hls-packager.js";

describe("playlistNeedsRebuild", () => {
  it("detects discontinuity and non-zero media sequence", () => {
    const dir = mkdtempSync(join(tmpdir(), "hls-pack-"));
    const path = join(dir, "index.m3u8");
    writeFileSync(
      path,
      [
        "#EXTM3U",
        "#EXT-X-MEDIA-SEQUENCE:12",
        "#EXT-X-DISCONTINUITY",
        "#EXTINF:4.0,",
        "seg_00000.ts",
        "",
      ].join("\n"),
    );
    expect(playlistNeedsRebuild(path)).toBe(true);
  });

  it("accepts a clean contiguous playlist", () => {
    const dir = mkdtempSync(join(tmpdir(), "hls-pack-"));
    const path = join(dir, "index.m3u8");
    writeFileSync(
      path,
      [
        "#EXTM3U",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXTINF:4.0,",
        "seg_00000.ts",
        "#EXT-X-ENDLIST",
        "",
      ].join("\n"),
    );
    expect(playlistNeedsRebuild(path)).toBe(false);
  });
});
