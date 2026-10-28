import { afterEach, describe, expect, it, vi } from "vitest";
import { liveVideoEncoder } from "./ffmpeg-video-encoder.js";
import {
  buildLiveHlsFfmpegArgs,
  liveHlsRestartDelayMs,
  LIVE_VIEWER_TTL_MS,
  LiveHlsManager,
} from "./live-hls.js";
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

describe("live viewer heartbeat", () => {
  it("releases the IPTV hold once every viewer of a channel stops heartbeating", () => {
    const iptv = new IptvConnectionManager(2);
    const manager = new LiveHlsManager("/tmp/reclinarr-viewer-test", iptv);
    manager.registerViewer("crashed-tv", "ch-a");
    iptv.holdLive("ch-a");
    manager.registerViewer("phone", "ch-b");
    iptv.holdLive("ch-b");
    expect(iptv.active).toBe(2);

    const later = Date.now() + LIVE_VIEWER_TTL_MS + 1_000;
    // The phone kept heartbeating; the TV went silent.
    vi.spyOn(Date, "now").mockReturnValue(later - 10_000);
    expect(manager.heartbeat("phone", "ch-b")).toBe(true);
    manager.reapSilentViewers(later);

    expect(manager.hasViewer("crashed-tv", "ch-a")).toBe(false);
    expect(manager.hasViewer("phone", "ch-b")).toBe(true);
    expect(iptv.snapshot().map((l) => l.label)).toEqual(["live:ch-b"]);
    vi.restoreAllMocks();
  });

  it("rejects a heartbeat for a channel the owner is not tuned to", () => {
    const manager = new LiveHlsManager("/tmp/reclinarr-viewer-test", new IptvConnectionManager(1));
    manager.registerViewer("web", "ch-a");
    expect(manager.heartbeat("web", "ch-b")).toBe(false);
    expect(manager.heartbeat("other", "ch-a")).toBe(false);
  });
});

describe("liveHlsRestartDelayMs", () => {
  it("backs off and caps", () => {
    expect(liveHlsRestartDelayMs(1)).toBe(750);
    expect(liveHlsRestartDelayMs(2)).toBe(1_500);
    expect(liveHlsRestartDelayMs(5)).toBe(12_000);
    expect(liveHlsRestartDelayMs(10)).toBe(12_000);
  });
});

describe("LiveHlsManager auto-restart", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks whether a channel still has viewers", () => {
    const manager = new LiveHlsManager("/tmp/reclinarr-restart-test", new IptvConnectionManager(2));
    manager.registerViewer("ios", "ch-a");
    manager.registerViewer("web", "ch-a");
    expect(manager.channelHasViewers("ch-a")).toBe(true);
    expect(manager.releaseViewer("ios", "ch-a")).toBeUndefined();
    expect(manager.channelHasViewers("ch-a")).toBe(true);
    expect(manager.releaseViewer("web", "ch-a")).toBe("ch-a");
    expect(manager.channelHasViewers("ch-a")).toBe(false);
  });

  it("schedules ensureReady again after an unexpected remux exit", async () => {
    vi.useFakeTimers();
    const manager = new LiveHlsManager("/tmp/reclinarr-restart-test", new IptvConnectionManager(2));
    manager.registerViewer("ios", "ch-a");
    const ensure = vi.spyOn(manager, "ensureReady").mockResolvedValue(undefined);
    // Simulate ffmpeg dying while the viewer is still tuned.
    (manager as unknown as { openers: Map<string, unknown> }).openers.set("ch-a", async () => {
      throw new Error("unused");
    });
    (manager as unknown as { scheduleRestart: (uuid: string) => void }).scheduleRestart("ch-a");
    expect(ensure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(750);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.calls[0]?.[0]).toBe("ch-a");
    manager.stop();
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
    expect(args.slice(args.indexOf("-c:v"), args.indexOf("-af"))).toEqual([
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-profile:v",
      "baseline",
      "-level",
      "3.1",
      "-pix_fmt",
      "yuv420p",
      "-force_key_frames",
      "expr:gte(t,n_forced*2)",
      "-g",
      "60",
      "-keyint_min",
      "48",
      "-sc_threshold",
      "0",
      "-bf",
      "0",
    ]);
  });

  it("puts the VAAPI device before the input and uploads frames", () => {
    const args = buildLiveHlsFfmpegArgs(
      "/tmp/live-hls/ch",
      "/tmp/live-hls/ch/index.m3u8",
      liveVideoEncoder("vaapi", 2, "/dev/dri/renderD128"),
    );
    expect(args.indexOf("-vaapi_device")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-vaapi_device") + 1]).toBe("/dev/dri/renderD128");
    expect(args[args.indexOf("-vf") + 1]).toBe("format=nv12,hwupload");
    expect(args).toContain("h264_vaapi");
    expect(args).not.toContain("libx264");
  });
});
