/** Streaming-service catalogue prefixes — never treat as languages. */
const SERVICE_PREFIXES = new Set([
  "d+",
  "dplus",
  "disney",
  "disney+",
  "nf",
  "netflix",
  "amzn",
  "amz",
  "amazon",
  "prime",
  "atvp",
  "apple",
  "a+",
  "hulu",
  "hbo",
  "max",
  "dsnp",
  "pcok",
  "peacock",
  "paramount",
  "paramount+",
  "p+",
  "pmtp",
  "osn",
  "osn+",
]);

/** Standalone quality / format tokens in a compound prefix (4K-EN, 3D-DE, …). */
const QUALITY_TOKENS = new Set([
  "4k",
  "uhd",
  "2160p",
  "1080p",
  "720p",
  "480p",
  "hdr",
  "hdr10",
  "dv",
  "3d",
  "plus",
  "cam",
  "hdcam",
  "ts",
]);

/**
 * Region / pack tags that appear before a language (AF-EN, SC - …).
 * Not treated as catalogue languages when a real language token is also present.
 */
const REGION_TOKENS = new Set(["af", "sc", "ex", "top", "soc", "la", "bn", "so"]);

/** Leading catalogue tag: "EN - Title", "4K-D+ - Title", "DE - Zoomania". */
const LEADING_PREFIX = /^(.+?)\s*[-–—|:.]\s+/;

export interface CatalogueLanguageHints {
  /** ISO-ish language from catalogue prefix (en, de, tr, …). */
  language?: string;
  /** Streaming platform hint (dplus, netflix, …). */
  platform?: string;
  /** Approximate vertical resolution when quality is known (2160 for 4K, …). */
  qualityHeight?: number;
  hdr?: boolean;
  evidence: string[];
}

const LANGUAGE_ALIASES: Record<string, string> = {
  eng: "en",
  en: "en",
  deu: "de",
  ger: "de",
  de: "de",
  fra: "fr",
  fre: "fr",
  fr: "fr",
  spa: "es",
  es: "es",
  ita: "it",
  it: "it",
  por: "pt",
  pt: "pt",
  tur: "tr",
  tr: "tr",
  kur: "ku",
  ku: "ku",
  nld: "nl",
  dut: "nl",
  nl: "nl",
  pol: "pl",
  pl: "pl",
  rus: "ru",
  ru: "ru",
  jpn: "ja",
  ja: "ja",
  kor: "ko",
  ko: "ko",
  chi: "zh",
  zho: "zh",
  zh: "zh",
  ara: "ar",
  ar: "ar",
  gre: "el",
  ell: "el",
  gr: "el",
  alb: "sq",
  sqi: "sq",
  al: "sq",
  fas: "fa",
  per: "fa",
  fa: "fa",
  ir: "fa",
  hin: "hi",
  hi: "hi",
  in: "hi",
  swe: "sv",
  sv: "sv",
  nor: "no",
  no: "no",
  dan: "da",
  da: "da",
  fin: "fi",
  fi: "fi",
  bul: "bg",
  bg: "bg",
  ron: "ro",
  rum: "ro",
  ro: "ro",
  heb: "he",
  he: "he",
  il: "he",
  ukr: "uk",
  uk: "uk",
};

export function normalizeLanguageTag(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toLowerCase().replace(/_/g, "-");
  if (!t || t === "und" || t === "unknown" || t === "null") return undefined;
  const primary = t.split("-")[0]!;
  return LANGUAGE_ALIASES[primary] ?? (primary.length <= 3 ? primary : undefined);
}

/**
 * Catalogue prefixes mix languages with platform/quality tags (P+, CAM, OSN+),
 * so only known aliases or plain two-letter codes count as a language there.
 */
function prefixLanguageTag(token: string): string | undefined {
  const known = LANGUAGE_ALIASES[token];
  if (known) return known;
  return /^[a-z]{2}$/.test(token) ? token : undefined;
}

function normalizeServicePlatform(tag: string): string | undefined {
  if (!SERVICE_PREFIXES.has(tag)) return undefined;
  if (tag === "d+" || tag === "disney+" || tag === "disney" || tag === "dsnp" || tag === "dplus") {
    return "dplus";
  }
  if (tag === "nf" || tag === "netflix") return "netflix";
  if (tag === "amzn" || tag === "amz" || tag === "prime" || tag === "amazon") return "amazon";
  if (tag === "atvp" || tag === "a+" || tag === "apple") return "apple";
  return tag;
}

function qualityHeightFromToken(token: string): number | undefined {
  const t = token.toLowerCase();
  if (t === "4k" || t === "uhd" || t === "2160p") return 2160;
  if (t === "1080p") return 1080;
  if (t === "720p") return 720;
  if (t === "480p") return 480;
  return undefined;
}

function isHdrToken(token: string): boolean {
  const t = token.toLowerCase();
  return t === "hdr" || t.startsWith("hdr10") || t === "dv";
}

/** Detect 4K / HDR markers anywhere in free text (incl. unicode catalogue glyphs). */
export function parseQualityHints(text?: string | null): {
  height?: number;
  hdr?: boolean;
  evidence: string[];
} {
  if (!text?.trim()) return { evidence: [] };
  const evidence: string[] = [];
  let height: number | undefined;
  let hdr = false;
  const lower = text.toLowerCase();

  if (/\b4k\b|uhd|\b2160p\b|⁴ᴷ|3840/.test(lower) || /⁴ᴷ/.test(text)) {
    height = 2160;
    evidence.push("quality:4k");
  } else if (/\b1080p\b/.test(lower)) {
    height = 1080;
    evidence.push("quality:1080p");
  } else if (/\b720p\b/.test(lower)) {
    height = 720;
    evidence.push("quality:720p");
  } else if (/\b480p\b/.test(lower)) {
    height = 480;
    evidence.push("quality:480p");
  }

  if (/\bhdr\b|hdr10|\bdv\b|ᴰᴼᴸᴮʸ/i.test(text)) {
    hdr = true;
    evidence.push("hdr");
  }

  return { height, hdr: hdr || undefined, evidence };
}

/**
 * Score quality for ranking. Higher is better.
 * This catalogue is mostly 4K-or-unknown; unknown stays at 0.
 */
export function scoreQualityPreference(input: {
  quality?: string | null;
  resolution?: string | null;
  label?: string | null;
  qualityHeight?: number;
  hdr?: boolean;
}): number {
  const fromFields = parseQualityHints(
    [input.quality, input.resolution, input.label].filter(Boolean).join(" "),
  );
  const height = input.qualityHeight ?? fromFields.height ?? 0;
  const hdr = Boolean(input.hdr ?? fromFields.hdr);
  if (height <= 0 && !hdr) return 0;
  return height + (hdr ? 100 : 0);
}

function parseCompoundPrefix(prefix: string): CatalogueLanguageHints {
  const evidence: string[] = [];
  let language: string | undefined;
  let platform: string | undefined;
  let qualityHeight: number | undefined;
  let hdr = false;

  // Keep + inside tokens (D+, A+): split on hyphen-like separators only.
  const parts = prefix
    .split(/[-–—_/]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  const langCandidates: string[] = [];

  for (const part of parts) {
    // Strip trailing junk on tokens like "hdr10" already handled; "subs" ignored.
    const token = part.replace(/\s+/g, "");
    if (!token || token === "subs" || token === "sub" || token === "dub") continue;

    const qh = qualityHeightFromToken(token);
    if (qh != null) {
      qualityHeight = Math.max(qualityHeight ?? 0, qh);
      evidence.push(`quality:${token}`);
      continue;
    }
    if (isHdrToken(token) || QUALITY_TOKENS.has(token)) {
      if (isHdrToken(token)) {
        hdr = true;
        evidence.push("hdr");
      }
      continue;
    }

    const svc = normalizeServicePlatform(token);
    if (svc) {
      platform ??= svc;
      evidence.push(`platform:${svc}`);
      continue;
    }

    if (REGION_TOKENS.has(token)) {
      evidence.push(`region:${token}`);
      continue;
    }

    const lang = prefixLanguageTag(token);
    if (lang) {
      langCandidates.push(lang);
    }
  }

  // Prefer the last language-looking token so AF-EN → en, AR-SUBS → ar (subs dropped).
  if (langCandidates.length) {
    language = langCandidates[langCandidates.length - 1];
    evidence.push(`catalogue_language:${language}`);
  }

  // Free-text quality fallback on the raw prefix (unicode 4K markers).
  const free = parseQualityHints(prefix);
  if (free.height != null) {
    qualityHeight = Math.max(qualityHeight ?? 0, free.height);
    evidence.push(...free.evidence.filter((e) => !evidence.includes(e)));
  }
  if (free.hdr) {
    hdr = true;
    if (!evidence.includes("hdr")) evidence.push("hdr");
  }

  return {
    language,
    platform,
    qualityHeight,
    hdr: hdr || undefined,
    evidence,
  };
}

export function parseCatalogueLanguageHints(input: {
  name?: string;
  group?: string;
}): CatalogueLanguageHints {
  const merged: CatalogueLanguageHints = { evidence: [] };

  for (const text of [input.name, input.group].filter(Boolean) as string[]) {
    const m = text.match(LEADING_PREFIX);
    if (!m?.[1]) {
      // No prefix — still scan for quality tokens in the whole string.
      const q = parseQualityHints(text);
      if (q.height != null && merged.qualityHeight == null) {
        merged.qualityHeight = q.height;
        merged.evidence.push(...q.evidence);
      }
      if (q.hdr) merged.hdr = true;
      continue;
    }

    const part = parseCompoundPrefix(m[1]!);
    if (part.language && !merged.language) {
      merged.language = part.language;
    }
    if (part.platform && !merged.platform) {
      merged.platform = part.platform;
    }
    if (part.qualityHeight != null) {
      merged.qualityHeight = Math.max(merged.qualityHeight ?? 0, part.qualityHeight);
    }
    if (part.hdr) merged.hdr = true;
    merged.evidence.push(...part.evidence);
  }

  return merged;
}

/**
 * Higher is better. Preferred[0] strongest.
 * Audio languages (when present) outweigh catalogue prefixes.
 */
export function scoreLanguagePreference(input: {
  preferredLanguages: string[];
  catalogueLanguage?: string;
  audioLanguages?: string[];
}): { score: number; reason: string; matched?: string } {
  const preferred: string[] = input.preferredLanguages
    .map((l) => normalizeLanguageTag(l))
    .filter((l): l is string => Boolean(l));
  if (!preferred.length) preferred.push("en");

  const audio = (input.audioLanguages ?? [])
    .map((l) => normalizeLanguageTag(l))
    .filter(Boolean) as string[];
  const catalogue = normalizeLanguageTag(input.catalogueLanguage);

  for (let i = 0; i < preferred.length; i++) {
    const p = preferred[i]!;
    if (audio.includes(p)) {
      return {
        score: 10_000 - i * 500,
        reason: `audio language ${p} matches preferred`,
        matched: p,
      };
    }
  }

  for (let i = 0; i < preferred.length; i++) {
    const p = preferred[i]!;
    if (catalogue === p) {
      return {
        score: 6_000 - i * 400,
        reason: `catalogue language ${p} matches preferred`,
        matched: p,
      };
    }
  }

  if (audio.length) {
    return {
      score: -4_000,
      reason: `audio languages [${audio.join(",")}] do not match preferred`,
    };
  }
  if (catalogue) {
    return {
      score: -3_000,
      reason: `catalogue language ${catalogue} does not match preferred`,
    };
  }
  return { score: 0, reason: "language unknown" };
}

export function isObviousLanguageMismatch(
  preferredLanguages: string[],
  catalogueLanguage?: string,
  audioLanguages?: string[],
): boolean {
  const preferred = new Set(
    preferredLanguages.map((l) => normalizeLanguageTag(l)).filter(Boolean) as string[],
  );
  if (!preferred.size) return false;
  const audio = (audioLanguages ?? [])
    .map((l) => normalizeLanguageTag(l))
    .filter(Boolean) as string[];
  if (audio.length && !audio.some((a) => preferred.has(a))) return true;
  const cat = normalizeLanguageTag(catalogueLanguage);
  if (cat && !preferred.has(cat) && !audio.length) return true;
  return false;
}

/**
 * Put a per-user language ahead of the server list.
 * Unknown or empty user language leaves the server order unchanged.
 */
export function withUserPreferredLanguage(
  serverLanguages: string[],
  userLanguage?: string | null,
): string[] {
  const server = serverLanguages
    .map((language) => normalizeLanguageTag(language))
    .filter((language): language is string => Boolean(language));
  const base = server.length ? server : ["en"];
  const user = normalizeLanguageTag(userLanguage);
  if (!user) return base;
  return [user, ...base.filter((language) => language !== user)];
}

/** First audio track whose language matches the preference. */
export function pickAudioTrackIndex(
  tracks: Array<{ index: number; language?: string | null }>,
  preferredLanguage?: string | null,
): number | undefined {
  const want = normalizeLanguageTag(preferredLanguage);
  if (!want) return undefined;
  return tracks.find((track) => normalizeLanguageTag(track.language) === want)?.index;
}

/** Parse comma-separated preferred language env (e.g. "it,en"). */
export function parsePreferredLanguages(raw?: string | null): string[] {
  if (!raw?.trim()) return ["en"];
  const list = raw
    .split(",")
    .map((l) => normalizeLanguageTag(l.trim()))
    .filter((l): l is string => Boolean(l));
  return list.length ? list : ["en"];
}

/**
 * How sure we are that an IPTV copy is in a preferred language.
 * Only `confirmed` and `corroborated` copies may be offered for on-demand play.
 */
export type CatalogueLanguageConfidence = "confirmed" | "corroborated" | "unknown" | "mismatch";

export type PlayableLanguageConfidence = Extract<
  CatalogueLanguageConfidence,
  "confirmed" | "corroborated"
>;

/** TMDb facts used to vouch for untagged IPTV copies. */
export interface TmdbLanguageReference {
  title?: string;
  originalTitle?: string;
  /** TMDb original_language (ISO 639-1). */
  originalLanguage?: string;
}

/** Build a reference from TMDb (Seerr) metadata; undefined when original language is unknown. */
export function tmdbLanguageReference(
  metadata?: { title?: string; originalTitle?: string; originalLanguage?: string } | null,
): TmdbLanguageReference | undefined {
  if (!metadata?.originalLanguage) return undefined;
  return {
    title: metadata.title,
    originalTitle: metadata.originalTitle,
    originalLanguage: metadata.originalLanguage,
  };
}

export function isPlayableLanguageConfidence(
  confidence?: CatalogueLanguageConfidence | null,
): confidence is PlayableLanguageConfidence {
  return confidence === "confirmed" || confidence === "corroborated";
}

/** Uppercase catalogue code block ("EN", "4K-EN", "AR-SUBS", "D+") — not a real title word. */
const CODE_PREFIX = /^[A-Z0-9+]{1,6}(?:[-_/][A-Z0-9+]{1,6})*$/;

function normalizeTitleText(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function stripTrailingTags(raw: string): string {
  let out = raw.trim();
  // "(2019)", "(US)", "[4K]" — repeatable trailing tags.
  while (/\s*[([][^()[\]]*[)\]]\s*$/.test(out)) {
    out = out.replace(/\s*[([][^()[\]]*[)\]]\s*$/, "").trim();
  }
  return out.replace(/\s+(?:19|20)\d{2}$/, "").trim();
}

/**
 * Comparable forms of an IPTV title: as-is and with leading catalogue code
 * blocks ("EN - ", "4K-D+ - ") removed. Both drop trailing year/country tags.
 */
export function catalogueTitleForms(name: string): string[] {
  const forms = new Set<string>();
  const raw = normalizeTitleText(stripTrailingTags(name));
  if (raw) forms.add(raw);

  let rest = name.trim();
  for (let i = 0; i < 3; i++) {
    const m = rest.match(LEADING_PREFIX);
    if (!m?.[1] || !CODE_PREFIX.test(m[1].replace(/\s+/g, ""))) break;
    rest = rest.slice(m[0].length);
  }
  const stripped = normalizeTitleText(stripTrailingTags(rest));
  if (stripped) forms.add(stripped);
  return [...forms];
}

function titleMatchesReference(name: string, reference: TmdbLanguageReference): boolean {
  const refs = [reference.title, reference.originalTitle]
    .filter((t): t is string => Boolean(t?.trim()))
    .map((t) => normalizeTitleText(stripTrailingTags(t)))
    .filter(Boolean);
  if (!refs.length) return false;
  return catalogueTitleForms(name).some((form) => refs.includes(form));
}

/**
 * Classify one IPTV copy. Explicit tags (audio, category, title prefix) decide
 * on their own; untagged copies are only trusted when TMDb vouches for them:
 * the title matches exactly AND the original language is preferred.
 */
export function assessCatalogueLanguage(input: {
  preferredLanguages: string[];
  catalogueLanguage?: string;
  audioLanguages?: string[];
  name?: string;
  reference?: TmdbLanguageReference;
}): { confidence: CatalogueLanguageConfidence; matched?: string } {
  const preferred = input.preferredLanguages
    .map((l) => normalizeLanguageTag(l))
    .filter((l): l is string => Boolean(l));
  if (!preferred.length) preferred.push("en");

  const audio = (input.audioLanguages ?? [])
    .map((l) => normalizeLanguageTag(l))
    .filter((l): l is string => Boolean(l));
  if (audio.length) {
    const hit = preferred.find((p) => audio.includes(p));
    return hit ? { confidence: "confirmed", matched: hit } : { confidence: "mismatch" };
  }

  const catalogue = normalizeLanguageTag(input.catalogueLanguage);
  if (catalogue) {
    return preferred.includes(catalogue)
      ? { confidence: "confirmed", matched: catalogue }
      : { confidence: "mismatch" };
  }

  const original = normalizeLanguageTag(input.reference?.originalLanguage);
  if (
    original &&
    preferred.includes(original) &&
    input.name &&
    input.reference &&
    titleMatchesReference(input.name, input.reference)
  ) {
    return { confidence: "corroborated", matched: original };
  }
  return { confidence: "unknown" };
}

export interface CatalogueLanguageScored<T> {
  item: T;
  score: number;
  qualityScore: number;
  catalogueLanguage?: string;
  qualityHeight?: number;
  confidence: PlayableLanguageConfidence;
}

/**
 * Keep only copies whose language is confirmed by a tag or corroborated by TMDb,
 * then pick confirmed over corroborated, the highest language score, then quality
 * (stable id tie-break). No trustworthy copy → null, so the title stays requestable.
 */
export function pickPreferredByCatalogueLanguage<T>(
  items: T[],
  preferredLanguages: string[],
  opts: {
    nameOf: (item: T) => string;
    idOf: (item: T) => number | string;
    groupOf?: (item: T) => string | undefined;
    reference?: TmdbLanguageReference;
  },
): CatalogueLanguageScored<T> | null {
  if (!items.length) return null;

  const pool: CatalogueLanguageScored<T>[] = [];
  for (const item of items) {
    const name = opts.nameOf(item);
    const hints = parseCatalogueLanguageHints({ name, group: opts.groupOf?.(item) });
    const { confidence, matched } = assessCatalogueLanguage({
      preferredLanguages,
      catalogueLanguage: hints.language,
      name,
      reference: opts.reference,
    });
    if (!isPlayableLanguageConfidence(confidence)) continue;
    // Corroborated copies carry the TMDb original language so later checks can re-verify it.
    const catalogueLanguage = hints.language ?? matched;
    const { score } = scoreLanguagePreference({
      preferredLanguages,
      catalogueLanguage: hints.language,
    });
    const qualityScore = scoreQualityPreference({
      label: name,
      qualityHeight: hints.qualityHeight,
      hdr: hints.hdr,
    });
    pool.push({
      item,
      score,
      qualityScore,
      catalogueLanguage,
      qualityHeight: hints.qualityHeight,
      confidence,
    });
  }

  pool.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "confirmed" ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    return String(opts.idOf(a.item)).localeCompare(String(opts.idOf(b.item)));
  });
  return pool[0] ?? null;
}

export type RankableStreamCandidate = {
  streamId?: string;
  m3uAccountId?: number;
  label?: string;
  catalogueLanguage?: string;
  qualityLabel?: string;
  resolutionHeight?: number;
  hdr?: boolean;
};

/**
 * Filter and rank IPTV stream candidates for one title.
 * Wrong-language streams are always dropped. Untagged streams are dropped when a
 * confirmed stream exists; otherwise they inherit the title-level verdict
 * (`untaggedPlayable`). Survivors rank by language, then quality (4K > unknown).
 */
export function rankDispatcharrStreamCandidates<T extends RankableStreamCandidate>(
  candidates: T[],
  preferredLanguages: string[],
  opts?: { untaggedPlayable?: boolean },
): Array<T & RankableStreamCandidate> {
  const untaggedPlayable = opts?.untaggedPlayable ?? true;
  const ranked = candidates.map((c, index) => {
    const hints = parseCatalogueLanguageHints({ name: c.label });
    const lang = c.catalogueLanguage ?? hints.language;
    const height = c.resolutionHeight ?? hints.qualityHeight;
    const hdr = c.hdr ?? hints.hdr;
    const { score: languageScore } = scoreLanguagePreference({
      preferredLanguages,
      catalogueLanguage: lang,
    });
    const qualityScore = scoreQualityPreference({
      quality: c.qualityLabel,
      label: c.label,
      qualityHeight: height,
      hdr,
    });
    const { confidence } = assessCatalogueLanguage({
      preferredLanguages,
      catalogueLanguage: lang,
    });
    return {
      c: {
        ...c,
        catalogueLanguage: lang,
        resolutionHeight: height,
        hdr,
      },
      confidence,
      languageScore,
      qualityScore,
      index,
    };
  });

  const anyConfirmed = ranked.some((r) => r.confidence === "confirmed");
  const kept = ranked.filter((r) => {
    if (r.confidence === "confirmed") return true;
    if (r.confidence === "mismatch") return false;
    return !anyConfirmed && untaggedPlayable;
  });

  kept.sort(
    (a, b) =>
      b.languageScore - a.languageScore ||
      b.qualityScore - a.qualityScore ||
      a.index - b.index,
  );
  return kept.map((r) => r.c);
}
