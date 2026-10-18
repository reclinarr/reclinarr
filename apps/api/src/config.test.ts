import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("Reclinarr configuration compatibility", () => {
  it("keeps existing server settings and data paths from STREAMERR variables", () => {
    const config = loadConfig({
      STREAMERR_PORT: "9010",
      STREAMERR_DATA_DIR: "/existing/library",
      STREAMERR_PUBLIC_URL: "https://existing.example",
      STREAMERR_PREFERRED_LANGUAGES: "it,en",
      STREAMERR_USE_MOCKS: "true",
    });
    expect(config.RECLINARR_PORT).toBe(9010);
    expect(config.RECLINARR_DATA_DIR).toBe("/existing/library");
    expect(config.RECLINARR_PUBLIC_URL).toBe("https://existing.example");
    expect(config.RECLINARR_PREFERRED_LANGUAGES).toEqual(["it", "en"]);
    expect(config.RECLINARR_USE_MOCKS).toBe(true);
  });

  it("prefers explicit RECLINARR settings over legacy values", () => {
    const config = loadConfig({
      STREAMERR_PORT: "9010",
      RECLINARR_PORT: "9020",
      STREAMERR_USE_MOCKS: "true",
      RECLINARR_USE_MOCKS: "false",
    });
    expect(config.RECLINARR_PORT).toBe(9020);
    expect(config.RECLINARR_USE_MOCKS).toBe(false);
  });

  it("accepts the existing production session secret", () => {
    const secret = "existing-production-session-secret";
    expect(loadConfig({ NODE_ENV: "production", STREAMERR_SESSION_SECRET: secret })
      .RECLINARR_SESSION_SECRET).toBe(secret);
  });

  it("still rejects an insecure production session secret", () => {
    expect(() => loadConfig({ NODE_ENV: "production" }))
      .toThrow("RECLINARR_SESSION_SECRET");
  });
});
