import { describe, expect, it } from "vitest";
import { DispatcharrProvider } from "./provider.js";

const untagged = {
  id: 99,
  uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa99",
  name: "NF - Fight Club",
  tmdb_id: "550",
  year: 1999,
};
const tagged = {
  id: 11,
  uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11",
  name: "EN - Fight Club",
  tmdb_id: "550",
  year: 1999,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function providerWithFetch(fetchImpl: typeof fetch): DispatcharrProvider {
  return new DispatcharrProvider({
    baseUrl: "https://dispatcharr.test",
    auth: { type: "apiKey", apiKey: "test" },
    preferredLanguages: ["en"],
    fetchImpl,
  });
}

describe("Dispatcharr findVodByTmdb language gating", () => {
  it("falls back to search when the known-id row is untagged and uncorroborated", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/api/vod/movies/99/")) return jsonResponse(untagged);
      if (url.includes("/api/vod/movies/") && url.includes("search=")) {
        return jsonResponse({ results: [untagged, tagged], count: 2 });
      }
      if (url.includes("/providers/") || url.includes("/provider-info/")) {
        return jsonResponse({}, 404);
      }
      return jsonResponse({ detail: "not found" }, 404);
    };

    const provider = providerWithFetch(fetchImpl);
    const media = await provider.findVodByTmdb(550, "movie", {
      titleHint: "Fight Club",
      yearHint: 1999,
      dispatcharrId: 99,
    });

    expect(media?.metadata.title).toBe("EN - Fight Club");
    const da = media?.availability.find((a) => a.provider === "dispatcharr");
    expect(da && "languageConfidence" in da ? da.languageConfidence : undefined).toBe("confirmed");
    expect(seen.some((u) => u.includes("search="))).toBe(true);
  });

  it("returns null when every copy is untagged and TMDb cannot corroborate", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/vod/movies/99/")) return jsonResponse(untagged);
      if (url.includes("/api/vod/movies/") && url.includes("search=")) {
        return jsonResponse({ results: [untagged], count: 1 });
      }
      return jsonResponse({}, 404);
    };

    const provider = providerWithFetch(fetchImpl);
    const media = await provider.findVodByTmdb(550, "movie", {
      titleHint: "Fight Club",
      dispatcharrId: 99,
    });
    expect(media).toBeNull();
  });

  it("keeps the untagged known-id row when TMDb title and original language match", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/api/vod/movies/99/")) return jsonResponse(untagged);
      if (url.includes("/providers/") || url.includes("/provider-info/")) {
        return jsonResponse({}, 404);
      }
      return jsonResponse({ results: [] });
    };

    const provider = providerWithFetch(fetchImpl);
    const media = await provider.findVodByTmdb(550, "movie", {
      titleHint: "Fight Club",
      dispatcharrId: 99,
      reference: { title: "Fight Club", originalLanguage: "en" },
    });

    expect(media?.metadata.title).toBe("NF - Fight Club");
    const da = media?.availability.find((a) => a.provider === "dispatcharr");
    expect(da && "languageConfidence" in da ? da.languageConfidence : undefined).toBe(
      "corroborated",
    );
    expect(seen.some((u) => u.includes("search="))).toBe(false);
  });
});
