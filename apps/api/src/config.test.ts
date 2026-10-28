import { describe, expect, it } from "vitest";
import { loadConfig, sessionCookieSecure } from "./config.js";

describe("Reclinarr configuration", () => {
  it("loads server settings and data paths from RECLINARR variables", () => {
    const config = loadConfig({
      RECLINARR_PORT: "9010",
      RECLINARR_DATA_DIR: "/existing/library",
      RECLINARR_PUBLIC_URL: "https://existing.example",
      RECLINARR_PREFERRED_LANGUAGES: "it,en",
      RECLINARR_USE_MOCKS: "true",
    });
    expect(config.RECLINARR_PORT).toBe(9010);
    expect(config.RECLINARR_DATA_DIR).toBe("/existing/library");
    expect(config.RECLINARR_PUBLIC_URL).toBe("https://existing.example");
    expect(config.RECLINARR_PREFERRED_LANGUAGES).toEqual(["it", "en"]);
    expect(config.RECLINARR_USE_MOCKS).toBe(true);
  });

  it("defaults live transcode hardware selection to auto", () => {
    expect(loadConfig({}).RECLINARR_HWACCEL).toBe("auto");
    expect(() => loadConfig({ RECLINARR_HWACCEL: "cuda" })).toThrow();
  });

  it("prefers environment variables over setup wizard values", () => {
    const config = loadConfig(
      { JELLYFIN_URL: "http://env-jellyfin:8096" },
      { JELLYFIN_URL: "http://wizard-jellyfin:8096", SEERR_API_KEY: "wizard-key" },
    );
    expect(config.JELLYFIN_URL).toBe("http://env-jellyfin:8096");
    expect(config.SEERR_API_KEY).toBe("wizard-key");
  });

  it("treats empty environment variables as unset", () => {
    const config = loadConfig(
      { JELLYFIN_URL: "", SEERR_API_KEY: "", HTTP_TIMEOUT_MS: "" },
      { JELLYFIN_URL: "http://wizard-jellyfin:8096", SEERR_API_KEY: "wizard-key" },
    );
    expect(config.JELLYFIN_URL).toBe("http://wizard-jellyfin:8096");
    expect(config.SEERR_API_KEY).toBe("wizard-key");
    expect(config.HTTP_TIMEOUT_MS).toBe(15_000);
  });

  it("rejects a public URL that is not a URL", () => {
    expect(() => loadConfig({ RECLINARR_PUBLIC_URL: "reclinarr.example" })).toThrow();
  });
});

describe("sessionCookieSecure", () => {
  it("follows the public URL scheme, not NODE_ENV (plain-HTTP Docker would drop a Secure cookie)", () => {
    expect(sessionCookieSecure(loadConfig({ NODE_ENV: "production", RECLINARR_PUBLIC_URL: "http://192.168.1.5:8787" }))).toBe(false);
    expect(sessionCookieSecure(loadConfig({ RECLINARR_PUBLIC_URL: "https://media.example" }))).toBe(true);
  });
});
