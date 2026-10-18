import { describe, expect, it } from "vitest";
import { IptvConnectionManager } from "./iptv-connection-manager.js";

describe("IptvConnectionManager", () => {
  it("does not let another live viewer preempt an existing live stream", () => {
    const manager = new IptvConnectionManager(1);
    const first = manager.acquire("live", { label: "live:first" });
    expect(() => manager.acquire("live", { label: "live:second" })).toThrow(/limit/i);
    expect(first.signal.aborted).toBe(false);
    first.release();
  });

  it("releases only the specified channel and preserves other viewers", () => {
    const manager = new IptvConnectionManager(2);
    const first = manager.holdLive("first");
    const second = manager.holdLive("second");
    manager.releaseLiveChannel("first");
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(manager.active).toBe(1);
    expect(manager.holdLive("second")).toBe(second);
    manager.releaseLiveChannel("second");
  });
  it("allows up to max connections and replaces equal-priority when full", () => {
    const mgr = new IptvConnectionManager(2);
    const a = mgr.acquire("acquisition", { label: "dl-1" });
    const b = mgr.acquire("playback");
    expect(mgr.active).toBe(2);
    // New acquisition replaces the older acquisition (equal priority), not playback.
    const c = mgr.acquire("acquisition", { label: "dl-2" });
    expect(mgr.active).toBe(2);
    expect(a.signal.aborted).toBe(true);
    expect(mgr.snapshot().some((l) => l.kind === "playback")).toBe(true);
    expect(mgr.snapshot().some((l) => l.label === "dl-2")).toBe(true);
    b.release();
    c.release();
    expect(mgr.active).toBe(0);
  });

  it("lets live preempt acquisition", () => {
    const mgr = new IptvConnectionManager(1);
    const acq = mgr.acquire("acquisition", { label: "dl" });
    expect(mgr.active).toBe(1);
    const live = mgr.acquire("live", { label: "ch1" });
    expect(mgr.active).toBe(1);
    expect(mgr.snapshot()[0]?.kind).toBe("live");
    // previous acquisition lease was force-released
    acq.release();
    live.release();
  });

  it("does not let acquisition preempt live", () => {
    const mgr = new IptvConnectionManager(1);
    const live = mgr.acquire("live");
    expect(() => mgr.acquire("acquisition")).toThrow(/limit/i);
    live.release();
  });

  it("lets a new playback replace an older playback (VOD scrub)", () => {
    const mgr = new IptvConnectionManager(1);
    const first = mgr.acquire("playback", { label: "vod:a" });
    const second = mgr.acquire("playback", { label: "vod:a" });
    expect(mgr.active).toBe(1);
    expect(mgr.snapshot()[0]?.id).toBe(second.id);
    expect(first.signal.aborted).toBe(true);
    second.release();
  });
});
