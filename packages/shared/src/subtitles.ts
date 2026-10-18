export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

const ISO6392_TO_6391: Record<string, string> = {
  eng: "en",
  spa: "es",
  fra: "fr",
  fre: "fr",
  deu: "de",
  ger: "de",
  ita: "it",
  por: "pt",
  nld: "nl",
  dut: "nl",
  swe: "sv",
  nor: "no",
  dan: "da",
  fin: "fi",
  pol: "pl",
  rus: "ru",
  jpn: "ja",
  kor: "ko",
  zho: "zh",
  chi: "zh",
  ara: "ar",
  hin: "hi",
  tur: "tr",
  ell: "el",
  gre: "el",
  heb: "he",
  ces: "cs",
  cze: "cs",
  hun: "hu",
  ron: "ro",
  rum: "ro",
  ukr: "uk",
  tha: "th",
  vie: "vi",
  ind: "id",
};

/** Collapse eng/en/en-US onto one code so Jellyfin and Bazarr tracks dedupe. */
export function normalizeSubtitleLanguage(language?: string | null): string {
  const base = (language ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if (!base || base === "und" || base === "undetermined") return "";
  return ISO6392_TO_6391[base] ?? base;
}

const CLOCK = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;

export function parseSubtitleTimestamp(raw: string): number | null {
  const match = CLOCK.exec(raw.trim().split(/\s+/)[0] ?? "");
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = (match[4] ?? "0").padEnd(3, "0").slice(0, 3);
  const ms = Number(fraction);
  if (![hours, minutes, seconds, ms].every((n) => Number.isFinite(n))) return null;
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

function formatTimestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

function cleanCueText(text: string): string {
  return text
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\{[^}]*\}/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r/g, "")
    .trim();
}

function parseAssTimestamp(raw: string): number | null {
  const match = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(raw.trim());
  if (!match) return parseSubtitleTimestamp(raw);
  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 100
  );
}

function parseAss(input: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const line of input.split("\n")) {
    if (!line.startsWith("Dialogue:")) continue;
    const parts = line.slice("Dialogue:".length).trim().split(",");
    if (parts.length < 10) continue;
    const start = parseAssTimestamp(parts[1] ?? "");
    const end = parseAssTimestamp(parts[2] ?? "");
    if (start == null || end == null || end <= start) continue;
    const text = cleanCueText(parts.slice(9).join(","));
    if (!text) continue;
    cues.push({ start, end, text });
  }
  return cues;
}

function isHeaderBlock(line: string): boolean {
  return (
    line.startsWith("WEBVTT") ||
    line.startsWith("NOTE") ||
    line.startsWith("STYLE") ||
    line.startsWith("REGION") ||
    line.startsWith("X-TIMESTAMP-MAP")
  );
}

/** Parse SRT, WebVTT, or ASS/SSA dialogue into cues. */
export function parseSubtitleCues(input: string): SubtitleCue[] {
  const raw = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!raw.trim()) return [];
  if (/^\[Script Info\]/m.test(raw) || /^Format:\s*Layer,\s*Start,\s*End/m.test(raw)) {
    return parseAss(raw);
  }

  const cues: SubtitleCue[] = [];
  for (const block of raw.split(/\n{2,}/)) {
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== "");
    const first = lines[0]?.trim() ?? "";
    if (!lines.length || isHeaderBlock(first)) continue;

    let timeIndex = 0;
    if (!first.includes("-->") && lines[1]?.includes("-->")) timeIndex = 1;
    const timing = lines[timeIndex];
    if (!timing?.includes("-->")) continue;
    const [startRaw, endRaw] = timing.split("-->");
    const start = parseSubtitleTimestamp(startRaw ?? "");
    const end = parseSubtitleTimestamp((endRaw ?? "").trim().split(/\s+/)[0] ?? "");
    if (start == null || end == null || end <= start) continue;
    const text = cleanCueText(lines.slice(timeIndex + 1).join("\n"));
    if (!text) continue;
    cues.push({ start, end, text });
  }
  return cues;
}

export function toWebVtt(input: string): string {
  const body = parseSubtitleCues(input)
    .map((cue) => `${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}${body ? "\n" : ""}`;
}
