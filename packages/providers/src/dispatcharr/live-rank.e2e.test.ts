import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DispatcharrProvider } from "./provider.js";

/** Load repo-root .env without printing secrets. */
function loadRootEnv(): void {
  const envPath = resolve(process.cwd(), "../../.env");
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2] ?? "";
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = val;
      }
    }
  } catch {
    // optional
  }
}

loadRootEnv();

const baseUrl = process.env.DISPATCHARR_URL?.trim();
const apiKey = process.env.DISPATCHARR_API_KEY?.trim();
const live = process.env.RECLINARR_LIVE_TESTS === "true" && Boolean(baseUrl && apiKey);

describe.skipIf(!live)("live Dispatcharr stream ranking (e2e)", () => {
  const provider = new DispatcharrProvider({
    baseUrl: baseUrl!,
    auth: { type: "apiKey", apiKey: apiKey! },
    preferredLanguages: ["en"],
    timeoutMs: 45_000,
  });

  it("Fight Club (tmdb 550): picks an EN category stream over DE/IR/service buckets", async () => {
    const media = await provider.findVodByTmdb(550, "movie", {
      titleHint: "Fight Club",
      yearHint: 1999,
      dispatcharrId: 4370,
    });
    expect(media).toBeTruthy();
    const da = media!.availability.find((a) => a.provider === "dispatcharr");
    expect(da?.canPlay).toBe(true);
    expect(da?.candidates?.length).toBeGreaterThan(1);

    const top = da!.candidates[0]!;
    const langs = da!.candidates.map((c) => c.catalogueLanguage);
    const labels = da!.candidates.map((c) => c.label);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          title: media!.metadata.title,
          top: {
            streamId: top.streamId,
            label: top.label,
            catalogueLanguage: top.catalogueLanguage,
            qualityLabel: top.qualityLabel,
            resolutionHeight: top.resolutionHeight,
          },
          candidateLangs: langs.slice(0, 8),
          candidateLabels: labels.slice(0, 8),
        },
        null,
        2,
      ),
    );

    expect(top.catalogueLanguage).toBe("en");
    expect(top.label?.toUpperCase().startsWith("EN")).toBe(true);
    expect(da?.languageConfidence).toBe("confirmed");
    expect(da!.candidates.every((c) => !c.catalogueLanguage || c.catalogueLanguage === "en")).toBe(
      true,
    );
  }, 60_000);

  it("4K-EN title (Books of Blood): catalogue + streams prefer EN, 4K ranks above plain EN", async () => {
    const media = await provider.findVodByTmdb(715123, "movie", {
      titleHint: "Books of Blood",
      yearHint: 2020,
      dispatcharrId: 16999,
    });
    expect(media).toBeTruthy();
    expect(media!.metadata.title).toMatch(/Books of Blood/i);

    const da = media!.availability.find((a) => a.provider === "dispatcharr");
    expect(da?.candidates?.length).toBeGreaterThan(0);
    const top = da!.candidates[0]!;

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          title: media!.metadata.title,
          catalogueLanguage: da?.catalogueLanguage,
          top,
          topLabels: da!.candidates.slice(0, 6).map((c) => ({
            label: c.label,
            lang: c.catalogueLanguage,
            quality: c.qualityLabel,
            height: c.resolutionHeight,
          })),
        },
        null,
        2,
      ),
    );

    // Title prefix 4K-EN should yield catalogue language en
    expect(da?.catalogueLanguage === "en" || top.catalogueLanguage === "en").toBe(true);

    const enWith4kIdx = da!.candidates.findIndex(
      (c) => c.catalogueLanguage === "en" && (c.qualityLabel === "4K" || c.resolutionHeight === 2160),
    );
    const enPlainIdx = da!.candidates.findIndex(
      (c) =>
        c.catalogueLanguage === "en" &&
        c.qualityLabel !== "4K" &&
        c.resolutionHeight !== 2160,
    );
    if (enWith4kIdx >= 0 && enPlainIdx >= 0) {
      expect(enWith4kIdx).toBeLessThan(enPlainIdx);
    }
    if (enWith4kIdx >= 0) {
      expect(top.catalogueLanguage).toBe("en");
      expect(top.qualityLabel === "4K" || top.resolutionHeight === 2160).toBe(true);
    }
  }, 60_000);

  it("resolveVodPlayback uses the ranked candidates[0] streamId", async () => {
    const media = await provider.findVodByTmdb(550, "movie", {
      titleHint: "Fight Club",
      yearHint: 1999,
      dispatcharrId: 4370,
    });
    expect(media).toBeTruthy();
    const da = media!.availability.find((a) => a.provider === "dispatcharr");
    const expectedStream = da?.candidates[0]?.streamId;
    expect(expectedStream).toBeTruthy();

    const source = await provider.resolveVodPlayback(media!.identity);
    expect(source).toBeTruthy();
    // Proxy URL should pin the chosen stream when streamId is present
    expect(source!.delivery.url).toContain("stream");
    if (expectedStream) {
      expect(
        source!.delivery.url.includes(`stream_id=${expectedStream}`) ||
          source!.delivery.url.includes(`streamId=${encodeURIComponent(expectedStream)}`) ||
          source!.delivery.url.includes(expectedStream),
      ).toBe(true);
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          expectedStream,
          playbackUrl: source!.delivery.url.replace(/token=[^&]+/gi, "token=…"),
          playMethod: source!.playMethod,
        },
        null,
        2,
      ),
    );
  }, 60_000);
});
