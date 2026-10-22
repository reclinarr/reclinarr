import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

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

  it("accepts a production session secret", () => {
    const secret = "existing-production-session-secret";
    expect(loadConfig({ NODE_ENV: "production", RECLINARR_SESSION_SECRET: secret })
      .RECLINARR_SESSION_SECRET).toBe(secret);
  });

  it("defaults live transcode hardware selection to auto", () => {
    expect(loadConfig({}).RECLINARR_HWACCEL).toBe("auto");
    expect(() => loadConfig({ RECLINARR_HWACCEL: "cuda" })).toThrow();
  });

  it("rejects an insecure production session secret", () => {
    expect(() => loadConfig({ NODE_ENV: "production" }))
      .toThrow("RECLINARR_SESSION_SECRET");
  });
});
