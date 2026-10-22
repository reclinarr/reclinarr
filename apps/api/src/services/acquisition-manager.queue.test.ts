import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MediaIdentity } from "@reclinarr/shared";
import { MockDispatcharrProvider } from "@reclinarr/providers";
import { createDb } from "../db/client.js";
import { AcquisitionManager } from "./acquisition-manager.js";

const episode = (n: number): MediaIdentity => ({
  tmdbId: 7,
  mediaType: "episode",
  seasonNumber: 1,
  episodeNumber: n,
});
const source = (n: number) => ({ provider: "dispatcharr" as const, uuid: `uuid-${n}`, episodeId: n });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "reclinarr-acq-queue-"));
  const manager = new AcquisitionManager(dir, new MockDispatcharrProvider(), createDb(dir));
  const finishers: Array<() => void> = [];
  const run = vi
    .spyOn(manager as unknown as { run: (id: string) => Promise<void> }, "run")
    .mockImplementation(() => new Promise<void>((resolve) => finishers.push(resolve)));
  return { manager, run, finishers };
}

describe("AcquisitionManager download queue", () => {
  it("runs queued downloads one at a time in order", async () => {
    const { manager, run, finishers } = setup();
    const a = await manager.start({ identity: episode(1), mode: "cache", source: source(1) }, { queued: true });
    const b = await manager.start({ identity: episode(2), mode: "cache", source: source(2) }, { queued: true });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe(a.id);

    finishers[0]!();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1]?.[0]).toBe(b.id);
  });

  it("lets Play jump a title out of the queue", async () => {
    const { manager, run } = setup();
    await manager.start({ identity: episode(1), mode: "cache", source: source(1) }, { queued: true });
    const waiting = await manager.start({ identity: episode(2), mode: "cache", source: source(2) }, { queued: true });
    expect(run).toHaveBeenCalledTimes(1);

    await manager.ensureCacheForPlay({ identity: episode(2), source: source(2) });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe(waiting.id);
  });
});
