import { describe, expect, it } from "vitest";
import { ReclinarrClient } from "./api.js";
import { loadAudioLanguagePref } from "./audio-pref.js";
import { loadSubtitlePref, saveSubtitlePref } from "./subtitle-pref.js";
import { memoryStorage } from "./storage.js";
import type { PreferencesResponse } from "./preferences.js";

function setup(server: PreferencesResponse) {
  const storage = memoryStorage();
  const calls: Array<{ method: string; body?: string }> = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, body: init?.body as string | undefined });
    if (method === "PUT") {
      const patch = JSON.parse(init?.body as string);
      server = { preferences: { ...server.preferences, ...patch }, saved: true };
    }
    return new Response(JSON.stringify(server), { status: 200 });
  }) as typeof fetch;
  const client = new ReclinarrClient({ baseUrl: "", fetchImpl, storage });
  return { client, storage, calls };
}

describe("syncPreferences", () => {
  it("mirrors saved server preferences into device storage", async () => {
    const { client, storage, calls } = setup({
      preferences: { audioLanguage: "it", subtitles: { mode: "on", language: "en" } },
      saved: true,
    });
    await client.syncPreferences();
    expect(await loadAudioLanguagePref(storage)).toBe("it");
    expect((await loadSubtitlePref(storage)).mode).toBe("on");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("uploads existing device preferences when the server has none", async () => {
    const { client, storage, calls } = setup({
      preferences: { audioLanguage: null, subtitles: { mode: "off" } },
      saved: false,
    });
    await saveSubtitlePref({ mode: "on", language: "fr" }, storage);
    const result = await client.syncPreferences();
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(result.subtitles).toMatchObject({ mode: "on", language: "fr" });
  });

  it("does not upload when neither side has anything", async () => {
    const { client, calls } = setup({
      preferences: { audioLanguage: null, subtitles: { mode: "off" } },
      saved: false,
    });
    await client.syncPreferences();
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });
});

describe("updatePreferences", () => {
  it("saves to the server and then to device storage", async () => {
    const { client, storage, calls } = setup({
      preferences: { audioLanguage: null, subtitles: { mode: "off" } },
      saved: false,
    });
    await client.updatePreferences({ audioLanguage: "de" });
    expect(calls).toEqual([{ method: "PUT", body: JSON.stringify({ audioLanguage: "de" }) }]);
    expect(await loadAudioLanguagePref(storage)).toBe("de");
  });
});
