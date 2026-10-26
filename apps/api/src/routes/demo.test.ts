import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createAppContext, type AppContext } from "../context.js";
import { SESSION_HEADER } from "../services/session.js";

let open: Array<{ ctx: AppContext; app: Awaited<ReturnType<typeof buildApp>> }> = [];
afterEach(async () => {
  for (const { ctx, app } of open) {
    await app.close();
    ctx.close();
  }
  open = [];
  vi.restoreAllMocks();
});

async function start(username: string) {
  const dir = mkdtempSync(join(tmpdir(), "reclinarr-demo-"));
  const ctx = createAppContext(
    loadConfig({ RECLINARR_USE_MOCKS: "true", RECLINARR_DATA_DIR: dir, RECLINARR_DEMO_USERS: "Reviewer, other" }),
  );
  const session = await ctx.sessions.create({
    jellyfinUserId: "u1",
    jellyfinUsername: username,
    jellyfinAccessToken: "tok",
    deviceId: "dev",
    deviceName: "Test",
  });
  const app = await buildApp(ctx, { onSetupSaved: vi.fn() });
  open.push({ ctx, app });
  return { ctx, app, headers: { [SESSION_HEADER]: session.id } };
}

const identity = { tmdbId: 603, mediaType: "movie" };

describe("demo accounts", () => {
  it("flags demo users case-insensitively in /api/auth/me", async () => {
    const demo = await start("reviewer");
    const me = await demo.app.inject({ method: "GET", url: "/api/auth/me", headers: demo.headers });
    expect(me.json().user.demo).toBe(true);

    const regular = await start("alice");
    const meRegular = await regular.app.inject({ method: "GET", url: "/api/auth/me", headers: regular.headers });
    expect(meRegular.json().user.demo).toBe(false);
  });

  it("refuses requests and IPTV downloads", async () => {
    const { app, ctx, headers } = await start("reviewer");
    const requestMedia = vi.spyOn(ctx.seerr, "requestMedia");
    const request = await app.inject({ method: "POST", url: "/api/request", headers, payload: { identity } });
    expect(request.statusCode).toBe(403);
    expect(requestMedia).not.toHaveBeenCalled();

    expect((await app.inject({ method: "GET", url: "/api/requests", headers })).statusCode).toBe(403);

    const acquire = await app.inject({
      method: "POST",
      url: "/api/acquisitions",
      headers,
      payload: { identity, source: { provider: "dispatcharr", uuid: "00000000-0000-4000-8000-000000000000" } },
    });
    expect(acquire.statusCode).toBe(403);
  });

  it("hides Seerr discovery and searches the library instead", async () => {
    const { app, ctx, headers } = await start("reviewer");
    const seerrSearch = vi.spyOn(ctx.seerr, "search");
    const trending = vi.spyOn(ctx.seerr, "discoverTrending");

    const discover = await app.inject({ method: "GET", url: "/api/discover/trending", headers });
    expect(discover.json()).toEqual({ items: [] });

    const search = await app.inject({ method: "GET", url: "/api/search?q=a", headers });
    expect(search.statusCode).toBe(200);
    expect(seerrSearch).not.toHaveBeenCalled();

    const home = await app.inject({ method: "GET", url: "/api/home", headers });
    expect(home.statusCode).toBe(200);
    expect(trending).not.toHaveBeenCalled();
  });

  it("leaves regular users untouched", async () => {
    const { app, ctx, headers } = await start("alice");
    const requestMedia = vi.spyOn(ctx.seerr, "requestMedia").mockResolvedValue();
    const request = await app.inject({ method: "POST", url: "/api/request", headers, payload: { identity } });
    expect(request.statusCode).toBe(200);
    expect(requestMedia).toHaveBeenCalled();
  });
});
