import { loadAudioLanguagePref, saveAudioLanguagePref } from "./audio-pref.js";
import { loadSubtitlePref, saveSubtitlePref, type SubtitlePref } from "./subtitle-pref.js";
import type { KeyValueStorage } from "./storage.js";

export interface UserPreferences {
  audioLanguage: string | null;
  subtitles: SubtitlePref;
}

export interface PreferencesResponse {
  preferences: UserPreferences;
  /** `false` until the user has saved preferences on any device. */
  saved: boolean;
}

export async function loadLocalPreferences(storage?: KeyValueStorage): Promise<UserPreferences> {
  const [audioLanguage, subtitles] = await Promise.all([
    loadAudioLanguagePref(storage),
    loadSubtitlePref(storage),
  ]);
  return { audioLanguage, subtitles };
}

/** The player reads these local keys synchronously, so the server copy is mirrored into them. */
export async function saveLocalPreferences(
  preferences: UserPreferences,
  storage?: KeyValueStorage,
): Promise<void> {
  await saveAudioLanguagePref(preferences.audioLanguage, storage);
  await saveSubtitlePref(preferences.subtitles, storage);
}

export function isDefaultPreferences(preferences: UserPreferences): boolean {
  return preferences.audioLanguage === null && preferences.subtitles.mode === "off";
}
