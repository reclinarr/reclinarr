import { describe, expect, it } from "vitest";
import { pickPreferredByCatalogueLanguage } from "@reclinarr/shared";
import type { DispatcharrMovie } from "./schemas.js";

/** Same TMDb id, different IPTV language/service prefixes — mirrors real catalogues. */
const zootopiaVariants: DispatcharrMovie[] = [
  {
    id: 10,
    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    name: "DE - Zoomania",
    tmdb_id: "269149",
    year: 2016,
  },
  {
    id: 11,
    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
    name: "EN - Zootopia",
    tmdb_id: "269149",
    year: 2016,
  },
  {
    id: 12,
    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
    name: "NF - Zootopia",
    tmdb_id: "269149",
    year: 2016,
  },
  {
    id: 13,
    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4",
    name: "KU - Zootopia",
    tmdb_id: "269149",
    year: 2016,
  },
  {
    id: 14,
    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5",
    name: "IT - Zootropolis",
    tmdb_id: "269149",
    year: 2016,
  },
];

describe("Dispatcharr catalogue language ranking", () => {
  it("picks EN when preferred is en", () => {
    const best = pickPreferredByCatalogueLanguage(zootopiaVariants, ["en"], {
      nameOf: (m) => m.name,
      idOf: (m) => m.id,
    });
    expect(best?.item.name).toBe("EN - Zootopia");
    expect(best?.catalogueLanguage).toBe("en");
  });

  it("prefers IT when it,en and IT variant exists", () => {
    const best = pickPreferredByCatalogueLanguage(zootopiaVariants, ["it", "en"], {
      nameOf: (m) => m.name,
      idOf: (m) => m.id,
    });
    expect(best?.item.name).toBe("IT - Zootropolis");
  });

  it("falls back to EN when IT missing from it,en prefs", () => {
    const withoutIt = zootopiaVariants.filter((m) => !m.name.startsWith("IT"));
    const best = pickPreferredByCatalogueLanguage(withoutIt, ["it", "en"], {
      nameOf: (m) => m.name,
      idOf: (m) => m.id,
    });
    expect(best?.item.name).toBe("EN - Zootopia");
  });

  it("soft-drops DE/KU when a preferred EN exists", () => {
    const best = pickPreferredByCatalogueLanguage(zootopiaVariants, ["en"], {
      nameOf: (m) => m.name,
      idOf: (m) => m.id,
    });
    expect(best?.item.name).not.toMatch(/^(DE|KU)\b/);
  });

  it("hides an untagged-only NF copy without a TMDb reference", () => {
    const onlyNf = zootopiaVariants.filter((m) => m.name.startsWith("NF"));
    const best = pickPreferredByCatalogueLanguage(onlyNf, ["en"], {
      nameOf: (m) => m.name,
      idOf: (m) => m.id,
    });
    expect(best).toBeNull();
  });

  it("keeps an untagged NF copy when TMDb title and original language match", () => {
    const onlyNf = zootopiaVariants.filter((m) => m.name.startsWith("NF"));
    const best = pickPreferredByCatalogueLanguage(onlyNf, ["en"], {
      nameOf: (m) => m.name,
      idOf: (m) => m.id,
      reference: { title: "Zootopia", originalLanguage: "en" },
    });
    expect(best?.item.name).toBe("NF - Zootopia");
    expect(best?.confidence).toBe("corroborated");
    expect(best?.catalogueLanguage).toBe("en");
  });
});
