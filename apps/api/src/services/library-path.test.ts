import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockDispatcharrProvider } from "@reclinarr/providers";
import { createDb } from "../db/client.js";
import { acquisitions } from "../db/schema.js";
import { AcquisitionManager } from "./acquisition-manager.js";
import { buildLibraryRelativePath, sanitizeLibraryName } from "./library-path.js";

describe("library-path", () => {
  it("sanitizes illegal characters", () => {
    expect(sanitizeLibraryName('Foo/Bar: "Baz"')).toBe("FooBar Baz");
  });

  it("builds movie folder layout", () => {
    const path = buildLibraryRelativePath(
      { mediaType: "movie", tmdbId: 123 },
      { title: "Inception", year: 2010 },
    );
    expect(path.replace(/\\/g, "/")).toBe(
      "library/movies/Inception (2010)/Inception (2010).mkv",
    );
  });

  it("builds episode season layout", () => {
    const path = buildLibraryRelativePath(
      { mediaType: "episode", tmdbId: 1396, seasonNumber: 1, episodeNumber: 2 },
      {
        title: "Breaking Bad",
        seriesTitle: "Breaking Bad",
        episodeTitle: "Cats in the Bag",
      },
    );
    expect(path.replace(/\\/g, "/")).toBe(
      "library/series/Breaking Bad [tmdbid-1396]/Season 01/Breaking Bad - S01E02 - Cats in the Bag.mkv",
    );
  });

  it("keeps same-named series in separate folders", () => {
    const us = buildLibraryRelativePath(
      { mediaType: "episode", tmdbId: 2316, seasonNumber: 1, episodeNumber: 1 },
      { title: "The Office", seriesTitle: "The Office", year: 2005 },
    );
    const uk = buildLibraryRelativePath(
      { mediaType: "episode", tmdbId: 2996, seasonNumber: 1, episodeNumber: 1 },
      { title: "The Office", seriesTitle: "The Office", year: 2001 },
    );
    expect(us.replace(/\\/g, "/")).toBe("library/series/The Office (2005) [tmdbid-2316]/Season 01/The Office - S01E01.mkv");
    expect(uk).not.toBe(us);
  });
});

describe("promoteToLibrary", () => {
  it("never replaces a different file already at the library path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reclinarr-libpath-"));
    const db = createDb(dir);
    const manager = new AcquisitionManager(dir, new MockDispatcharrProvider(), db);
    manager.setLibraryMetaResolver(async () => ({ title: "Same", seriesTitle: "Same" }));
    const now = new Date().toISOString();
    const insert = (id: string, bytes: string) => {
      const localPath = join(dir, "acquisitions", "cache", `${id}.bin`);
      mkdirSync(dirname(localPath), { recursive: true });
      writeFileSync(localPath, bytes);
      db.insert(acquisitions).values({
        id, tmdbId: null, mediaType: "episode", mode: "cache", state: "completed",
        bytesDownloaded: bytes.length, localPath, playbackAvailable: true,
        sourceJson: JSON.stringify({ provider: "dispatcharr", uuid: id }),
        identityJson: JSON.stringify({ mediaType: "episode", seasonNumber: 1, episodeNumber: 1 }),
        createdAt: now, updatedAt: now,
      }).run();
    };
    insert("00000000-0000-4000-8000-000000000001", "first");
    insert("00000000-0000-4000-8000-000000000002", "second");
    const first = await manager.promoteToLibrary("00000000-0000-4000-8000-000000000001");
    await expect(manager.promoteToLibrary("00000000-0000-4000-8000-000000000002")).rejects.toMatchObject({ statusCode: 409 });
    expect(readFileSync(first!.localPath!, "utf8")).toBe("first");
  });
});
