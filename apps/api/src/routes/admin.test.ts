import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createAppContext, type AppContext } from "../context.js";
import { SESSION_HEADER } from "../services/session.js";
import { writeSetupConfig } from "../setup-store.js";

async function setup(admin: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "reclinarr-admin-"));
  writeSetupConfig(dir, { SEERR_URL: "http://seerr:5055", SEERR_API_KEY: "s3cret" });
  const ctx = createAppContext(
    loadConfig({ RECLINARR_USE_MOCKS: "true", RECLINARR_DATA_DIR: dir }, { SEERR_URL: "http://seerr:5055", SEERR_API_KEY: "s3cret" }),
  );
  vi.spyOn(ctx.jellyfin, "isAdministrator").mockResolvedValue(admin);
  const session = await ctx.sessions.create({
    jellyfinUserId: "u1",
    jellyfinUsername: "user",
    jellyfinAccessToken: "tok",
    deviceId: "dev",
    deviceName: "Test",
  });
  const onSaved = vi.fn();
  const app = await buildApp(ctx, { onSetupSaved: onSaved });
  return { ctx, app, dir, onSaved, headers: { [SESSION_HEADER]: session.id } };
}

let open: Array<{ ctx: AppContext; app: Awaited<ReturnType<typeof buildApp>> }> = [];
afterEach(async () => {
  for (const { ctx, app } of open) {
    await app.close();
    ctx.close();
  }
  open = [];
  vi.restoreAllMocks();
});

async function start(admin: boolean) {
  const s = await setup(admin);
  open.push(s);
  return s;
}

describe("admin service routes", () => {
  it("requires a session", async () => {
    const { app } = await start(true);
    expect((await app.inject({ method: "GET", url: "/api/admin/services" })).statusCode).toBe(401);
  });

  it("tells non-admins they are not admins and refuses edits", async () => {
    const { app, headers, dir, onSaved } = await start(false);
    const list = await app.inject({ method: "GET", url: "/api/admin/services", headers });
    expect(list.json()).toEqual({ admin: false });
    const put = await app.inject({
      method: "PUT",
      url: "/api/admin/services/seerr",
      headers,
      payload: { values: { SEERR_URL: "http://evil" } },
    });
    expect(put.statusCode).toBe(403);
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).SEERR_URL).toBe("http://seerr:5055");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("lists services to admins without leaking secrets", async () => {
    const { app, headers } = await start(true);
    const res = await app.inject({ method: "GET", url: "/api/admin/services", headers });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("s3cret");
    expect(res.json().services.map((s: { id: string }) => s.id)).toEqual([
      "jellyfin",
      "seerr",
      "dispatcharr",
      "bazarr",
    ]);
  });

  it("saves an edit, keeps the stored secret, and reloads", async () => {
    const { app, headers, dir, onSaved } = await start(true);
    const res = await app.inject({
      method: "PUT",
      url: "/api/admin/services/seerr",
      headers,
      payload: { values: { SEERR_URL: "http://new-seerr:5055", SEERR_API_KEY: "" } },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8"))).toEqual({
      SEERR_URL: "http://new-seerr:5055",
      SEERR_API_KEY: "s3cret",
    });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it("rejects invalid input and unknown services", async () => {
    const { app, headers } = await start(true);
    const bad = await app.inject({
      method: "PUT",
      url: "/api/admin/services/seerr",
      headers,
      payload: { values: { SEERR_URL: "not a url" } },
    });
    expect(bad.statusCode).toBe(400);
    const unknown = await app.inject({
      method: "PUT",
      url: "/api/admin/services/nope",
      headers,
      payload: {},
    });
    expect(unknown.statusCode).toBe(404);
  });
});
