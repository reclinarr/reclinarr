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

async function start() {
  const dir = mkdtempSync(join(tmpdir(), "reclinarr-live-"));
  const ctx = createAppContext(loadConfig({ RECLINARR_USE_MOCKS: "true", RECLINARR_DATA_DIR: dir }));
  const session = await ctx.sessions.create({
    jellyfinUserId: "u1",
    jellyfinUsername: "alice",
    jellyfinAccessToken: "tok",
    deviceId: "dev",
    deviceName: "Test",
  });
  const app = await buildApp(ctx, { onSetupSaved: vi.fn() });
  open.push({ ctx, app });
  return { ctx, app, session, headers: { [SESSION_HEADER]: session.id } };
}

const KNOWN = "11111111-1111-1111-1111-111111111101";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

describe("live tuning", () => {
  it("refuses unknown channels without registering a viewer", async () => {
    const { app, ctx, session, headers } = await start();
    const res = await app.inject({ method: "POST", url: `/api/live/play/${UNKNOWN}`, headers, payload: {} });
    expect(res.statusCode).toBe(404);
    expect(ctx.liveHls.hasViewer(session.id, UNKNOWN)).toBe(false);
  });

  it("accepts heartbeats only for the tuned channel", async () => {
    const { app, headers } = await start();
    expect((await app.inject({ method: "POST", url: `/api/live/play/${KNOWN}`, headers, payload: {} })).statusCode).toBe(200);
    const beat = (uuid: string) => app.inject({ method: "POST", url: "/api/live/heartbeat", headers, payload: { uuid } });
    expect((await beat(KNOWN)).json()).toEqual({ ok: true });
    expect((await beat(UNKNOWN)).json()).toEqual({ ok: false });
  });
});

describe("live guide window", () => {
  it("rejects windows longer than 24 hours, reversed, or not ISO dates", async () => {
    const { app, ctx, headers } = await start();
    const guide = vi.spyOn(ctx.dispatcharr, "getGuideWindow");
    for (const qs of [
      "start=2026-01-01T00:00:00Z&end=2026-02-01T00:00:00Z",
      "start=2026-01-02T00:00:00Z&end=2026-01-01T00:00:00Z",
      "start=yesterday&end=tomorrow",
    ]) {
      expect((await app.inject({ method: "GET", url: `/api/live/guide?${qs}`, headers })).statusCode, qs).toBe(400);
    }
    expect(guide).not.toHaveBeenCalled();

    const ok = await app.inject({
      method: "GET",
      url: "/api/live/guide?start=2026-01-01T00:00:00.000Z&end=2026-01-01T04:00:00.000Z",
      headers,
    });
    expect(ok.statusCode).toBe(200);
  });
});
