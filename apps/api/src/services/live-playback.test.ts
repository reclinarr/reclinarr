import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context.js";
import { releaseLivePlayback } from "./live-playback.js";
import { LiveHlsManager } from "./live-hls.js";
import { IptvConnectionManager } from "./iptv-connection-manager.js";

describe("releaseLivePlayback", () => {
  it("does not release a new tune or another session's live stream", () => {
    const connections = new IptvConnectionManager(2);
    const hls = new LiveHlsManager("/tmp/reclinarr-live-test", connections);
    const stopChannel = vi.spyOn(hls, "stopChannel").mockImplementation(() => undefined);
    const ctx = { liveHls: hls, iptvConnections: connections } as AppContext;
    hls.registerViewer("ios", "new-channel");
    hls.registerViewer("tv", "tv-channel");
    const ios = connections.holdLive("new-channel");
    const tv = connections.holdLive("tv-channel");
    releaseLivePlayback(ctx, "ios", "old-channel");
    expect(stopChannel).not.toHaveBeenCalled();
    releaseLivePlayback(ctx, "ios", "new-channel");
    expect(ios.signal.aborted).toBe(true);
    expect(tv.signal.aborted).toBe(false);
    expect(hls.hasViewer("tv", "tv-channel")).toBe(true);
    tv.release();
  });
});
