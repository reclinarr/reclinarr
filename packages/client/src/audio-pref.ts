import { normalizeLanguageTag } from "@reclinarr/shared";
import { AUDIO_LANG_PREF_KEY, readStorage, writeStorage, type KeyValueStorage } from "./storage.js";

function parseLanguage(raw: string | null): string | null {
  return normalizeLanguageTag(raw) ?? null;
}

export function loadAudioLanguagePrefSync(storage?: KeyValueStorage): string | null {
  if (!storage) return null;
  const raw = storage.getItem(AUDIO_LANG_PREF_KEY);
  if (typeof raw !== "string") return null;
  return parseLanguage(raw);
}

export async function loadAudioLanguagePref(storage?: KeyValueStorage): Promise<string | null> {
  return parseLanguage(await readStorage(storage, AUDIO_LANG_PREF_KEY));
}

/** `null` clears the preference and lets the title use its default audio. */
export async function saveAudioLanguagePref(
  language: string | null,
  storage?: KeyValueStorage,
): Promise<void> {
  if (!storage) return;
  const code = normalizeLanguageTag(language);
  if (!code) {
    await storage.removeItem?.(AUDIO_LANG_PREF_KEY);
    return;
  }
  await writeStorage(storage, AUDIO_LANG_PREF_KEY, code);
}
