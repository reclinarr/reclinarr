import { describe, expect, it } from "vitest";
import {
  assessCatalogueLanguage,
  catalogueTitleForms,
  isObviousLanguageMismatch,
  normalizeLanguageTag,
  parseCatalogueLanguageHints,
  parsePreferredLanguages,
  parseQualityHints,
  pickAudioTrackIndex,
  pickPreferredByCatalogueLanguage,
  withUserPreferredLanguage,
  rankDispatcharrStreamCandidates,
  scoreLanguagePreference,
  scoreQualityPreference,
  tmdbLanguageReference,
} from "./iptv-language.js";

describe("normalizeLanguageTag", () => {
  it("maps ISO639-2 and aliases", () => {
    expect(normalizeLanguageTag("eng")).toBe("en");
    expect(normalizeLanguageTag("ITA")).toBe("it");
    expect(normalizeLanguageTag("en-US")).toBe("en");
    expect(normalizeLanguageTag("und")).toBeUndefined();
  });
});

describe("parseCatalogueLanguageHints", () => {
  it("parses EN / IT / DE title prefixes", () => {
    expect(parseCatalogueLanguageHints({ name: "EN - Zootopia" }).language).toBe("en");
    expect(parseCatalogueLanguageHints({ name: "IT - Zootropolis" }).language).toBe("it");
    expect(parseCatalogueLanguageHints({ name: "DE - Zoomania" }).language).toBe("de");
  });

  it("does not treat streaming service prefixes as language", () => {
    const hints = parseCatalogueLanguageHints({ name: "NF - Zootopia" });
    expect(hints.language).toBeUndefined();
    expect(hints.platform).toBe("netflix");
  });

  it("skips quality prefixes and reads language after them", () => {
    // Leading quality+service: "4K-D+ - Title" → platform only
    const svc = parseCatalogueLanguageHints({ name: "4K-D+ - Zootopia" });
    expect(svc.platform).toBe("dplus");
    expect(svc.language).toBeUndefined();
    expect(svc.qualityHeight).toBe(2160);
  });

  it("parses compound 4K-EN / 4K-FR-HDR / 3D-DE / AF-EN prefixes", () => {
    const en4k = parseCatalogueLanguageHints({ name: "4K-EN - Books of Blood (2020)" });
    expect(en4k.language).toBe("en");
    expect(en4k.qualityHeight).toBe(2160);

    const frHdr = parseCatalogueLanguageHints({ name: "4K-FR-HDR - L'Enfant Du Désert" });
    expect(frHdr.language).toBe("fr");
    expect(frHdr.qualityHeight).toBe(2160);
    expect(frHdr.hdr).toBe(true);

    const de3d = parseCatalogueLanguageHints({ name: "3D-DE - Alles fliegt dir um die Ohren" });
    expect(de3d.language).toBe("de");

    const afEn = parseCatalogueLanguageHints({ name: "AF-EN - Flipped" });
    expect(afEn.language).toBe("en");
  });

  it("treats NF - Fight Club as service-only (no language)", () => {
    const hints = parseCatalogueLanguageHints({ name: "NF - Fight Club" });
    expect(hints.language).toBeUndefined();
    expect(hints.platform).toBe("netflix");
  });

  it("inherits language from group when name is service-only", () => {
    const hints = parseCatalogueLanguageHints({
      name: "D+ - Zootopia",
      group: "DE - Zoomania",
    });
    expect(hints.platform).toBe("dplus");
    expect(hints.language).toBe("de");
  });
});

describe("scoreQualityPreference", () => {
  it("scores 4K above unknown", () => {
    expect(scoreQualityPreference({ quality: "4K" })).toBeGreaterThan(
      scoreQualityPreference({ label: "EN - DRAMA" }),
    );
    expect(scoreQualityPreference({ quality: "4K" })).toBe(2160);
    expect(scoreQualityPreference({})).toBe(0);
  });

  it("parses quality from free text", () => {
    expect(parseQualityHints("NORDIC FILM ⁴ᴷ ³⁸⁴⁰ᴾ").height).toBe(2160);
  });
});

describe("scoreLanguagePreference", () => {
  it("prefers catalogue language match over mismatch", () => {
    const en = scoreLanguagePreference({
      preferredLanguages: ["en"],
      catalogueLanguage: "en",
    });
    const de = scoreLanguagePreference({
      preferredLanguages: ["en"],
      catalogueLanguage: "de",
    });
    expect(en.score).toBeGreaterThan(de.score);
    expect(en.score).toBe(6000);
    expect(de.score).toBe(-3000);
  });

  it("ranks preferred list order", () => {
    const it = scoreLanguagePreference({
      preferredLanguages: ["it", "en"],
      catalogueLanguage: "it",
    });
    const en = scoreLanguagePreference({
      preferredLanguages: ["it", "en"],
      catalogueLanguage: "en",
    });
    expect(it.score).toBeGreaterThan(en.score);
  });

  it("lets audio outweigh catalogue prefix", () => {
    const audio = scoreLanguagePreference({
      preferredLanguages: ["en"],
      catalogueLanguage: "de",
      audioLanguages: ["eng"],
    });
    expect(audio.score).toBe(10_000);
    expect(audio.matched).toBe("en");
  });

  it("scores unknown catalogue language as zero", () => {
    expect(
      scoreLanguagePreference({
        preferredLanguages: ["en"],
      }).score,
    ).toBe(0);
  });
});

describe("isObviousLanguageMismatch", () => {
  it("flags wrong catalogue language without audio", () => {
    expect(isObviousLanguageMismatch(["en"], "de")).toBe(true);
    expect(isObviousLanguageMismatch(["en"], "en")).toBe(false);
    expect(isObviousLanguageMismatch(["en"], undefined)).toBe(false);
  });
});

describe("pickPreferredByCatalogueLanguage", () => {
  const items = [
    { id: 1, name: "DE - Zoomania" },
    { id: 2, name: "EN - Zootopia" },
    { id: 3, name: "NF - Zootopia" },
    { id: 4, name: "KU - Zootopia" },
  ];

  it("picks EN when preferred is en", () => {
    const best = pickPreferredByCatalogueLanguage(items, ["en"], {
      nameOf: (i) => i.name,
      idOf: (i) => i.id,
    });
    expect(best?.item.name).toBe("EN - Zootopia");
    expect(best?.catalogueLanguage).toBe("en");
  });

  it("prefers IT when listed first and present", () => {
    const withIt = [...items, { id: 5, name: "IT - Zootropolis" }];
    const best = pickPreferredByCatalogueLanguage(withIt, ["it", "en"], {
      nameOf: (i) => i.name,
      idOf: (i) => i.id,
    });
    expect(best?.item.name).toBe("IT - Zootropolis");
  });

  it("falls back to EN when IT missing from it,en prefs", () => {
    const best = pickPreferredByCatalogueLanguage(items, ["it", "en"], {
      nameOf: (i) => i.name,
      idOf: (i) => i.id,
    });
    expect(best?.item.name).toBe("EN - Zootopia");
  });

  it("soft-drops DE/KU when EN exists", () => {
    const best = pickPreferredByCatalogueLanguage(items, ["en"], {
      nameOf: (i) => i.name,
      idOf: (i) => i.id,
    });
    expect(best?.item.name).not.toMatch(/^(DE|KU)\b/);
  });

  it("hides untagged copies when language cannot be corroborated", () => {
    const onlyNf = [{ id: 3, name: "NF - Zootopia" }];
    const best = pickPreferredByCatalogueLanguage(onlyNf, ["en"], {
      nameOf: (i) => i.name,
      idOf: (i) => i.id,
    });
    expect(best).toBeNull();
  });

  it("corroborates an untagged copy when TMDb title and original language match", () => {
    const onlyNf = [{ id: 3, name: "NF - Zootopia" }];
    const best = pickPreferredByCatalogueLanguage(onlyNf, ["en"], {
      nameOf: (i) => i.name,
      idOf: (i) => i.id,
      reference: { title: "Zootopia", originalTitle: "Zootopia", originalLanguage: "en" },
    });
    expect(best?.item.name).toBe("NF - Zootopia");
    expect(best?.confidence).toBe("corroborated");
    expect(best?.catalogueLanguage).toBe("en");
  });

  it("does not corroborate when TMDb original language is not preferred", () => {
    const onlyNf = [{ id: 3, name: "NF - Zootopia" }];
    const best = pickPreferredByCatalogueLanguage(onlyNf, ["en"], {
      nameOf: (i) => i.name,
      idOf: (i) => i.id,
      reference: { title: "Zootopia", originalLanguage: "ja" },
    });
    expect(best).toBeNull();
  });

  it("ranks a tagged match above a corroborated untagged copy", () => {
    const best = pickPreferredByCatalogueLanguage(items, ["en"], {
      nameOf: (i) => i.name,
      idOf: (i) => i.id,
      reference: { title: "Zootopia", originalLanguage: "en" },
    });
    expect(best?.item.name).toBe("EN - Zootopia");
    expect(best?.confidence).toBe("confirmed");
  });

  it("returns no match when every copy is in another language", () => {
    const onlyForeign = [
      { id: 1, name: "DE - Crystal Lake (2026) (US)" },
      { id: 2, name: "AR-SUBS - Crystal Lake (2026) (US)" },
    ];
    const best = pickPreferredByCatalogueLanguage(onlyForeign, ["en"], {
      nameOf: (i) => i.name,
      idOf: (i) => i.id,
    });
    expect(best).toBeNull();
  });

  it("does not read platform or quality prefixes as languages", () => {
    expect(parseCatalogueLanguageHints({ name: "P+ - FBI (2018)" }).language).toBeUndefined();
    expect(parseCatalogueLanguageHints({ name: "CAM - Some Film (2026)" }).language).toBeUndefined();
    expect(parseCatalogueLanguageHints({ name: "4K-OSN+ - Game of Thrones" }).language).toBeUndefined();
    expect(parseCatalogueLanguageHints({ name: "IR - Resident Dead" }).language).toBe("fa");
    expect(parseCatalogueLanguageHints({ name: "AR-SUBS - Crystal Lake" }).language).toBe("ar");
  });

  it("prefers 4K-EN over EN when language matches", () => {
    const rows = [
      { id: 1, name: "EN - Punchdrunk: Behind the Mask (2023)" },
      { id: 2, name: "4K-EN - Books of Blood (2020)" },
      { id: 3, name: "NF - Fight Club" },
    ];
    const best = pickPreferredByCatalogueLanguage(rows, ["en"], {
      nameOf: (i) => i.name,
      idOf: (i) => i.id,
    });
    expect(best?.item.name).toBe("4K-EN - Books of Blood (2020)");
    expect(best?.qualityHeight).toBe(2160);
  });
});

describe("assessCatalogueLanguage", () => {
  it("confirms an explicit matching tag", () => {
    expect(
      assessCatalogueLanguage({
        preferredLanguages: ["en"],
        catalogueLanguage: "en",
        name: "EN - Title",
      }),
    ).toEqual({ confidence: "confirmed", matched: "en" });
  });

  it("flags a tagged mismatch", () => {
    expect(
      assessCatalogueLanguage({
        preferredLanguages: ["en"],
        catalogueLanguage: "de",
        name: "DE - Title",
      }).confidence,
    ).toBe("mismatch");
  });

  it("corroborates an untagged title that matches TMDb in a preferred original language", () => {
    expect(
      assessCatalogueLanguage({
        preferredLanguages: ["en"],
        name: "NF - Title (2019)",
        reference: { title: "Title", originalLanguage: "en" },
      }),
    ).toEqual({ confidence: "corroborated", matched: "en" });
  });

  it("stays unknown when the IPTV title does not match TMDb", () => {
    expect(
      assessCatalogueLanguage({
        preferredLanguages: ["en"],
        name: "NF - Completely Different",
        reference: { title: "Title", originalLanguage: "en" },
      }).confidence,
    ).toBe("unknown");
  });

  it("stays unknown without a TMDb reference", () => {
    expect(
      assessCatalogueLanguage({
        preferredLanguages: ["en"],
        name: "NF - Title",
      }).confidence,
    ).toBe("unknown");
  });
});

describe("catalogueTitleForms", () => {
  it("strips catalogue prefixes, years, and country tags", () => {
    expect(catalogueTitleForms("EN - Title (2019)")).toContain("title");
    expect(catalogueTitleForms("4K-EN - Title (US)")).toContain("title");
    expect(catalogueTitleForms("NF - Title")).toContain("title");
  });
});

describe("tmdbLanguageReference", () => {
  it("requires an original language", () => {
    expect(tmdbLanguageReference({ title: "Title" })).toBeUndefined();
    expect(tmdbLanguageReference({ title: "Title", originalLanguage: "en" })).toEqual({
      title: "Title",
      originalTitle: undefined,
      originalLanguage: "en",
    });
  });
});

describe("rankDispatcharrStreamCandidates", () => {
  it("drops wrong-language and untagged streams when a confirmed stream exists", () => {
    const ranked = rankDispatcharrStreamCandidates(
      [
        { streamId: "de", label: "DE - FILME 1940/2024" },
        { streamId: "en", label: "EN - IMDB TOP 250" },
        { streamId: "ir", label: "IR - PERSIAN SUB/DUB" },
        { streamId: "nf", label: "NETFLIX MOVIES" },
      ],
      ["en"],
    );
    expect(ranked.map((c) => c.streamId)).toEqual(["en"]);
    expect(ranked[0]?.catalogueLanguage).toBe("en");
  });

  it("keeps untagged streams only when the title-level verdict allows it", () => {
    const kept = rankDispatcharrStreamCandidates(
      [{ streamId: "nf", label: "NETFLIX MOVIES" }],
      ["en"],
      { untaggedPlayable: true },
    );
    expect(kept.map((c) => c.streamId)).toEqual(["nf"]);

    const dropped = rankDispatcharrStreamCandidates(
      [{ streamId: "nf", label: "NETFLIX MOVIES" }],
      ["en"],
      { untaggedPlayable: false },
    );
    expect(dropped).toEqual([]);
  });

  it("drops mismatch-only streams even when they are the only copies", () => {
    const ranked = rankDispatcharrStreamCandidates(
      [{ streamId: "de", label: "DE - FILME" }],
      ["en"],
    );
    expect(ranked).toEqual([]);
  });

  it("among EN categories, prefers quality 4K over empty", () => {
    const ranked = rankDispatcharrStreamCandidates(
      [
        { streamId: "sd", label: "EN - DRAMA", qualityLabel: undefined },
        { streamId: "uhd", label: "EN - DRAMA", qualityLabel: "4K" },
      ],
      ["en"],
    );
    expect(ranked[0]?.streamId).toBe("uhd");
  });

  it("never lets non-preferred 4K beat preferred language", () => {
    const ranked = rankDispatcharrStreamCandidates(
      [
        { streamId: "it4k", label: "IT - 4K MOVIES", qualityLabel: "4K" },
        { streamId: "en720", label: "EN - DRAMA" },
      ],
      ["en"],
    );
    expect(ranked[0]?.streamId).toBe("en720");
  });
});

describe("parsePreferredLanguages", () => {
  it("parses comma lists and defaults", () => {
    expect(parsePreferredLanguages("it, en")).toEqual(["it", "en"]);
    expect(parsePreferredLanguages("")).toEqual(["en"]);
    expect(parsePreferredLanguages(null)).toEqual(["en"]);
  });
});

describe("withUserPreferredLanguage", () => {
  it("puts the user language first and keeps the server fallbacks", () => {
    expect(withUserPreferredLanguage(["en"], "it")).toEqual(["it", "en"]);
    expect(withUserPreferredLanguage(["en", "it"], "eng")).toEqual(["en", "it"]);
    expect(withUserPreferredLanguage(["en"], null)).toEqual(["en"]);
  });
});

describe("pickAudioTrackIndex", () => {
  it("matches ISO codes and leaves unknown languages unset", () => {
    const tracks = [
      { index: 1, language: "eng" },
      { index: 2, language: "ita" },
    ];
    expect(pickAudioTrackIndex(tracks, "it")).toBe(2);
    expect(pickAudioTrackIndex(tracks, "de")).toBeUndefined();
    expect(pickAudioTrackIndex(tracks, null)).toBeUndefined();
  });
});
