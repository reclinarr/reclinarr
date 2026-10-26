import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import {
  ServiceEditError,
  applyServiceEdit,
  describeServices,
  envLockedKeys,
  probeInputFor,
  serviceDefinition,
} from "./service-settings.js";

const none = new Set<string>();
const seerr = serviceDefinition("seerr")!;
const dispatcharr = serviceDefinition("dispatcharr")!;
const jellyfin = serviceDefinition("jellyfin")!;

describe("describeServices", () => {
  it("never exposes secret values and marks env-locked fields", () => {
    const env = { JELLYFIN_URL: "http://env-jf:8096" };
    const config = loadConfig(env, { SEERR_URL: "http://seerr:5055", SEERR_API_KEY: "s3cret" });
    const views = describeServices(config, env);
    expect(JSON.stringify(views)).not.toContain("s3cret");
    const seerrView = views.find((v) => v.id === "seerr")!;
    expect(seerrView.configured).toBe(true);
    expect(seerrView.fields.find((f) => f.key === "SEERR_API_KEY")).toMatchObject({ set: true, locked: false });
    expect(seerrView.fields.find((f) => f.key === "SEERR_API_KEY")).not.toHaveProperty("value");
    expect(views.find((v) => v.id === "jellyfin")!.fields[0]).toMatchObject({
      value: "http://env-jf:8096",
      locked: true,
    });
    expect(views.find((v) => v.id === "bazarr")!.configured).toBe(false);
  });

  it("treats an empty environment variable as unlocked", () => {
    expect(envLockedKeys({ JELLYFIN_URL: "" }).has("JELLYFIN_URL")).toBe(false);
  });
});

describe("applyServiceEdit", () => {
  it("keeps a stored secret when the field is left blank", () => {
    const next = applyServiceEdit(
      seerr,
      { values: { SEERR_URL: "http://new:5055/", SEERR_API_KEY: "" }, clear: [] },
      { SEERR_URL: "http://old:5055", SEERR_API_KEY: "keep-me" },
      none,
    );
    expect(next).toEqual({ SEERR_URL: "http://new:5055", SEERR_API_KEY: "keep-me" });
  });

  it("replaces and clears secrets", () => {
    const stored = { DISPATCHARR_API_KEY: "old", DISPATCHARR_PASSWORD: "pw" };
    const next = applyServiceEdit(
      dispatcharr,
      { values: { DISPATCHARR_PASSWORD: "new-pw" }, clear: ["DISPATCHARR_API_KEY"] },
      stored,
      none,
    );
    expect(next).toEqual({ DISPATCHARR_PASSWORD: "new-pw" });
  });

  it("does not touch other services' saved values", () => {
    const next = applyServiceEdit(
      seerr,
      { values: { SEERR_URL: "http://s:5055" }, clear: [] },
      { BAZARR_URL: "http://b:6767" },
      none,
    );
    expect(next.BAZARR_URL).toBe("http://b:6767");
  });

  it("removes an optional address when it is emptied", () => {
    const next = applyServiceEdit(seerr, { values: { SEERR_URL: "" }, clear: [] }, { SEERR_URL: "http://s" }, none);
    expect(next).toEqual({});
  });

  it("requires a Jellyfin address", () => {
    expect(() => applyServiceEdit(jellyfin, { values: { JELLYFIN_URL: " " }, clear: [] }, {}, none)).toThrow(
      ServiceEditError,
    );
  });

  it("rejects non-http addresses", () => {
    expect(() =>
      applyServiceEdit(seerr, { values: { SEERR_URL: "ftp://host" }, clear: [] }, {}, none),
    ).toThrow(/http/);
  });

  it("rejects fields from another service", () => {
    expect(() =>
      applyServiceEdit(seerr, { values: { BAZARR_URL: "http://b" }, clear: [] }, {}, none),
    ).toThrow(ServiceEditError);
  });

  it("refuses to change a field locked by the environment", () => {
    expect(() =>
      applyServiceEdit(jellyfin, { values: { JELLYFIN_URL: "http://x" }, clear: [] }, {}, new Set(["JELLYFIN_URL"])),
    ).toThrow(expect.objectContaining({ statusCode: 409 }));
  });

  it("refuses to clear a non-secret field", () => {
    expect(() => applyServiceEdit(seerr, { values: {}, clear: ["SEERR_URL"] }, {}, none)).toThrow(ServiceEditError);
  });
});

describe("probeInputFor", () => {
  it("tests with the stored secret when the form leaves it blank", () => {
    const config = loadConfig({}, { SEERR_URL: "http://old", SEERR_API_KEY: "stored" });
    const input = probeInputFor(seerr, { values: { SEERR_URL: "http://new", SEERR_API_KEY: "" }, clear: [] }, config, none);
    expect(input).toMatchObject({ service: "seerr", SEERR_URL: "http://new", SEERR_API_KEY: "stored" });
  });

  it("drops a secret that is being cleared", () => {
    const config = loadConfig({}, { DISPATCHARR_URL: "http://d", DISPATCHARR_API_KEY: "stored" });
    const input = probeInputFor(dispatcharr, { values: {}, clear: ["DISPATCHARR_API_KEY"] }, config, none);
    expect(input).toMatchObject({ DISPATCHARR_API_KEY: "" });
  });
});
