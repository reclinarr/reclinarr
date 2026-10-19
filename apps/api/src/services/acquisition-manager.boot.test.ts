import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockDispatcharrProvider } from "@reclinarr/providers";
import { createDb } from "../db/client.js";
import { acquisitions } from "../db/schema.js";
import { AcquisitionManager } from "./acquisition-manager.js";

function seedJob(
  db: ReturnType<typeof createDb>,
  opts: { id: string; state: string; localPath?: string },
) {
  const now = new Date().toISOString();
  db.insert(acquisitions)
    .values({
      id: opts.id,
      tmdbId: 42,
      mediaType: "movie",
      mode: "cache",
      state: opts.state,
      bytesDownloaded: 2_000_000,
      totalBytes: 100_000_000,
      localPath: opts.localPath ?? join(tmpdir(), `${opts.id}.bin`),
      playbackAvailable: opts.state === "playable",
      sourceJson: JSON.stringify({ uuid: "u", streamId: "1" }),
      identityJson: JSON.stringify({ tmdbId: 42, mediaType: "movie" }),
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe("AcquisitionManager boot", () => {
  it("does not fail in-flight jobs on construct (packager-safe)", () => {
    const dir = mkdtempSync(join(tmpdir(), "reclinarr-acq-"));
    const db = createDb(dir);
    seedJob(db, { id: "dl-1", state: "downloading", localPath: join(dir, "a.bin") });
    seedJob(db, { id: "pl-1", state: "playable", localPath: join(dir, "b.bin") });

    const mgr = new AcquisitionManager(dir, new MockDispatcharrProvider(), db);
    const jobs = mgr.listPackagerJobs();
    expect(jobs.map((j) => j.id).sort()).toEqual(["dl-1", "pl-1"]);
    expect(mgr.get("dl-1")?.state).toBe("downloading");
    expect(mgr.get("pl-1")?.state).toBe("playable");
  });

  it("failInterruptedOnBoot marks downloading/queued/playable as failed", () => {
    const dir = mkdtempSync(join(tmpdir(), "reclinarr-acq-"));
    const db = createDb(dir);
    seedJob(db, { id: "dl-1", state: "downloading", localPath: join(dir, "a.bin") });
    seedJob(db, { id: "q-1", state: "queued", localPath: join(dir, "b.bin") });
    seedJob(db, { id: "done", state: "completed", localPath: join(dir, "c.bin") });

    const mgr = new AcquisitionManager(dir, new MockDispatcharrProvider(), db);
    expect(mgr.failInterruptedOnBoot()).toBe(2);
    expect(mgr.get("dl-1")?.state).toBe("failed");
    expect(mgr.get("q-1")?.state).toBe("failed");
    expect(mgr.get("done")?.state).toBe("completed");
    expect(mgr.listPackagerJobs().map((j) => j.id)).toEqual(["done"]);
  });
});
