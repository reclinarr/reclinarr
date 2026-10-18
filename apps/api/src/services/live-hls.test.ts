import { describe, expect, it } from "vitest";
import { buildLiveHlsFfmpegArgs, LiveHlsManager } from "./live-hls.js";
import { IptvConnectionManager } from "./iptv-connection-manager.js";

describe("live viewer ownership", () => {
  it("ignores delayed cleanup for a channel after retuning", () => {
    const manager = new LiveHlsManager("/tmp/reclinarr-viewer-test", new IptvConnectionManager(1));
    manager.registerViewer("ios", "first");
    expect(manager.releaseViewer("ios")).toBe("first");
    manager.registerViewer("ios", "second");
    expect(manager.releaseViewer("ios", "first")).toBeUndefined();
    expect(manager.hasViewer("ios", "second")).toBe(true);
  });

  it("keeps a shared channel until its last viewer leaves", () => {
    const manager = new LiveHlsManager("/tmp/reclinarr-viewer-test", new IptvConnectionManager(2));
    manager.registerViewer("ios", "shared");
    manager.registerViewer("web", "shared");
    manager.registerViewer("tv", "other");
    expect(manager.releaseViewer("ios", "shared")).toBeUndefined();
    expect(manager.releaseViewer("web", "other")).toBeUndefined();
    expect(manager.releaseViewer("web", "shared")).toBe("shared");
    expect(manager.hasViewer("tv", "other")).toBe(true);
  });
});

describe("buildLiveHlsFfmpegArgs", () => {
  it("locks A/V with aresample async and time-based keyframes", () => {
    const args = buildLiveHlsFfmpegArgs("/tmp/live-hls/ch", "/tmp/live-hls/ch/index.m3u8");
    expect(args).toContain("-af");
    expect(args[args.indexOf("-af") + 1]).toBe("aresample=async=1:first_pts=0");
    expect(args).toContain("-force_key_frames");
    expect(args[args.indexOf("-force_key_frames") + 1]).toBe("expr:gte(t,n_forced*2)");
    expect(args).toContain("-max_interleave_delta");
    expect(args).toContain("delete_segments+independent_segments+omit_endlist");
    expect(args.at(-1)).toBe("/tmp/live-hls/ch/index.m3u8");
  });
});
