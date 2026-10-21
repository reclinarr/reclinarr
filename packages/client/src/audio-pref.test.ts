import { describe, expect, it } from "vitest";
import { loadAudioLanguagePref, saveAudioLanguagePref } from "./audio-pref.js";
import { memoryStorage } from "./storage.js";

describe("audio language preference", () => {
  it("stores a normalized language and clears back to the default", async () => {
    const storage = memoryStorage();
    expect(await loadAudioLanguagePref(storage)).toBeNull();
    await saveAudioLanguagePref("ITA", storage);
    expect(await loadAudioLanguagePref(storage)).toBe("it");
    await saveAudioLanguagePref(null, storage);
    expect(await loadAudioLanguagePref(storage)).toBeNull();
  });
});
