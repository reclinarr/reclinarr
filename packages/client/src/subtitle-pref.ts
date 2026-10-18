import { normalizeSubtitleLanguage, type SubtitleTrack } from "@reclinarr/shared";
import { readStorage, SUBTITLE_PREF_KEY, writeStorage, type KeyValueStorage } from "./storage.js";

export type SubtitlePref =
  | { mode: "off" }
  | {
      mode: "on";
      language: string;
      forced?: boolean;
      hearingImpaired?: boolean;
    };

function parsePref(raw: string | null): SubtitlePref {
  if (!raw) return { mode: "off" };
  try {
    const parsed = JSON.parse(raw) as SubtitlePref;
    if (parsed?.mode === "off") return { mode: "off" };
    if (parsed?.mode === "on" && typeof parsed.language === "string") {
      return {
        mode: "on",
        language: normalizeSubtitleLanguage(parsed.language),
        forced: Boolean(parsed.forced),
        hearingImpaired: Boolean(parsed.hearingImpaired),
      };
    }
  } catch {
    /* ignore */
  }
  return { mode: "off" };
}

export function loadSubtitlePrefSync(storage?: KeyValueStorage): SubtitlePref {
  if (!storage) return { mode: "off" };
  const raw = storage.getItem(SUBTITLE_PREF_KEY);
  if (typeof raw !== "string") return { mode: "off" };
  return parsePref(raw);
}

export async function loadSubtitlePref(storage?: KeyValueStorage): Promise<SubtitlePref> {
  const raw = await readStorage(storage, SUBTITLE_PREF_KEY);
  return parsePref(raw);
}

export async function saveSubtitlePref(pref: SubtitlePref, storage?: KeyValueStorage): Promise<void> {
  await writeStorage(storage, SUBTITLE_PREF_KEY, JSON.stringify(pref));
}

export async function saveSubtitleOff(storage?: KeyValueStorage): Promise<void> {
  await saveSubtitlePref({ mode: "off" }, storage);
}

export async function saveSubtitleTrack(track: SubtitleTrack, storage?: KeyValueStorage): Promise<void> {
  await saveSubtitlePref(
    {
      mode: "on",
      language: normalizeSubtitleLanguage(track.language) || "",
      forced: Boolean(track.forced),
      hearingImpaired: Boolean(track.hearingImpaired),
    },
    storage,
  );
}

/**
 * Restore the last subtitle choice for this title's tracks.
 * Default (no saved pref / Off): null. When On, match language (+ flags).
 */
export function resolveSubtitleIndex(
  tracks: SubtitleTrack[],
  pref: SubtitlePref,
): number | null {
  if (!tracks.length || pref.mode === "off") return null;

  const wantLang = normalizeSubtitleLanguage(pref.language);
  const score = (track: SubtitleTrack, index: number) => {
    const lang = normalizeSubtitleLanguage(track.language);
    let value = 0;
    if (wantLang && lang === wantLang) value += 10;
    else if (!wantLang) value += 1;
    else return -1;
    if (Boolean(track.forced) === Boolean(pref.forced)) value += 2;
    if (Boolean(track.hearingImpaired) === Boolean(pref.hearingImpaired)) value += 1;
    return value * 100 - index;
  };

  let best: number | null = null;
  let bestScore = -1;
  for (let i = 0; i < tracks.length; i += 1) {
    const s = score(tracks[i]!, i);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  if (wantLang && bestScore < 10) return null;
  return best;
}
