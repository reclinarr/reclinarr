import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "../db/client.js";
import { PreferencesStore, preferencesPatchSchema } from "./preferences.js";

function store() {
  return new PreferencesStore(createDb(mkdtempSync(join(tmpdir(), "reclinarr-prefs-"))));
}

describe("PreferencesStore", () => {
  it("returns defaults for a user with nothing saved", () => {
    expect(store().get("u1")).toEqual({ audioLanguage: null, subtitles: { mode: "off" } });
  });

  it("distinguishes never-saved from saved defaults", () => {
    const prefs = store();
    expect(prefs.find("u1")).toBeNull();
    prefs.update("u1", { audioLanguage: null });
    expect(prefs.find("u1")).toEqual({ audioLanguage: null, subtitles: { mode: "off" } });
  });

  it("merges a partial update into what is stored", () => {
    const prefs = store();
    prefs.update("u1", { audioLanguage: "it" });
    const next = prefs.update("u1", { subtitles: { mode: "on", language: "en" } });
    expect(next).toEqual({ audioLanguage: "it", subtitles: { mode: "on", language: "en" } });
    expect(prefs.get("u1")).toEqual(next);
  });

  it("clears the audio language with null", () => {
    const prefs = store();
    prefs.update("u1", { audioLanguage: "it" });
    expect(prefs.update("u1", { audioLanguage: null }).audioLanguage).toBeNull();
  });

  it("keeps users separate", () => {
    const prefs = store();
    prefs.update("u1", { audioLanguage: "it" });
    expect(prefs.get("u2").audioLanguage).toBeNull();
  });
});

describe("preferencesPatchSchema", () => {
  it("rejects a subtitle selection with no language field", () => {
    expect(preferencesPatchSchema.safeParse({ subtitles: { mode: "on" } }).success).toBe(false);
  });

  it("rejects an oversized language tag", () => {
    expect(preferencesPatchSchema.safeParse({ audioLanguage: "x".repeat(17) }).success).toBe(false);
  });
});
