import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createAppContext, type AppContext } from "../context.js";
import { SESSION_REVALIDATE_MS } from "../plugins/auth.js";
import { SESSION_COOKIE, SESSION_HEADER } from "../services/session.js";

let open: Array<{ ctx: AppContext; app: Awaited<ReturnType<typeof buildApp>> }> = [];
afterEach(async () => {
  for (const { ctx, app } of open) {
    await app.close();
    ctx.close();
  }
  open = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function start() {
  const dir = mkdtempSync(join(tmpdir(), "reclinarr-auth-"));
  const ctx = createAppContext(loadConfig({ RECLINARR_USE_MOCKS: "true", RECLINARR_DATA_DIR: dir }));
  const login = (username: string) =>
    ctx.sessions.create({
      jellyfinUserId: `id-${username}`,
      jellyfinUsername: username,
      jellyfinAccessToken: `tok-${username}`,
      deviceId: "dev",
      deviceName: "Test",
    });
  const app = await buildApp(ctx, { onSetupSaved: vi.fn() });
  open.push({ ctx, app });
  return { ctx, app, login };
}

describe("session resolution", () => {
  it("prefers the explicit header over a cookie another origin could have planted", async () => {
    const { app, login } = await start();
    const mine = await login("alice");
    const planted = await login("mallory");
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { [SESSION_HEADER]: mine.id, cookie: `${SESSION_COOKIE}=${planted.id}` },
    });
    expect(me.json().user.username).toBe("alice");
  });

  it("ends a session once Jellyfin stops accepting its token", async () => {
    const { app, ctx, login } = await start();
    const session = await login("alice");
    const headers = { [SESSION_HEADER]: session.id };
    const isTokenValid = vi.spyOn(ctx.jellyfin, "isTokenValid").mockResolvedValue(false);

    // A fresh session is trusted without a Jellyfin round-trip.
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers })).statusCode).toBe(200);
    expect(isTokenValid).not.toHaveBeenCalled();

    vi.useFakeTimers({ now: Date.now() + SESSION_REVALIDATE_MS + 1_000, toFake: ["Date"] });
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers })).statusCode).toBe(401);
    expect(isTokenValid).toHaveBeenCalledOnce();
    expect(await ctx.sessions.get(session.id)).toBeNull();
  });

  it("keeps the session when Jellyfin cannot be reached", async () => {
    const { app, ctx, login } = await start();
    const session = await login("alice");
    vi.spyOn(ctx.jellyfin, "isTokenValid").mockRejectedValue(new Error("ECONNREFUSED"));
    vi.useFakeTimers({ now: Date.now() + SESSION_REVALIDATE_MS + 1_000, toFake: ["Date"] });
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { [SESSION_HEADER]: session.id } });
    expect(me.statusCode).toBe(200);
  });

  it("accepts the query-string session only for GET media and image routes", async () => {
    const { app, login } = await start();
    const session = await login("alice");
    const q = `reclinarr_session=${session.id}`;
    expect((await app.inject({ method: "GET", url: `/api/auth/me?${q}` })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/live/stop?${q}`, payload: {} })).statusCode).toBe(401);
    // Authenticated (passes requireAuth); mock mode then answers 404 for the image itself.
    expect((await app.inject({ method: "GET", url: `/api/images/dispatcharr/logo/1?${q}` })).statusCode).toBe(404);
  });

  it("revokes the Jellyfin token on logout", async () => {
    const { app, ctx, login } = await start();
    const session = await login("alice");
    const logout = vi.spyOn(ctx.jellyfin, "logout");
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { [SESSION_HEADER]: session.id } });
    expect(logout).toHaveBeenCalledWith(expect.objectContaining({ jellyfinAccessToken: "tok-alice" }));
  });

  it("sends baseline browser protections on every response", async () => {
    const { app } = await start();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "referrer-policy": "same-origin",
      "content-security-policy": "frame-ancestors 'self'",
    });
  });

  it("releases the live tune on logout", async () => {
    const { app, ctx, login } = await start();
    const session = await login("alice");
    ctx.liveHls.registerViewer(session.id, "00000000-0000-4000-8000-0000000000aa");
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { [SESSION_HEADER]: session.id } });
    expect(ctx.liveHls.channelHasViewers("00000000-0000-4000-8000-0000000000aa")).toBe(false);
  });
});
