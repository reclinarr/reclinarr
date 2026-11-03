import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DispatcharrProvider } from "@reclinarr/providers";
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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** App whose Dispatcharr is a real provider over a fake upstream. */
async function start(upstream: (logoId: string) => Response) {
  const dir = mkdtempSync(join(tmpdir(), "reclinarr-images-"));
  const ctx = createAppContext(loadConfig({ RECLINARR_USE_MOCKS: "true", RECLINARR_DATA_DIR: dir }));
  const logoRequests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const id = /\/api\/channels\/logos\/(\d+)\/cache\//.exec(String(input))?.[1] ?? "";
    logoRequests.push(id);
    return upstream(id);
  };
  Object.assign(ctx, {
    useMocks: false,
    dispatcharr: new DispatcharrProvider({
      baseUrl: "https://dispatcharr.test",
      auth: { type: "apiKey", apiKey: "test" },
      fetchImpl,
    }),
  });
  const session = await ctx.sessions.create({
    jellyfinUserId: "u1",
    jellyfinUsername: "alice",
    jellyfinAccessToken: "tok",
    deviceId: "dev",
    deviceName: "Test",
  });
  const app = await buildApp(ctx, { onSetupSaved: vi.fn() });
  open.push({ ctx, app });
  return { app, logoRequests, headers: { [SESSION_HEADER]: session.id } };
}

describe("channel logo proxy", () => {
  it("fetches a logo from Dispatcharr once and serves repeats from memory", async () => {
    const { app, headers, logoRequests } = await start(
      () => new Response(PNG, { headers: { "Content-Type": "image/png" } }),
    );

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: "GET", url: "/api/images/dispatcharr/logo/42", headers });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.rawPayload.equals(PNG)).toBe(true);
    }
    expect(logoRequests).toEqual(["42"]);
  });

  it("does not cache upstream errors", async () => {
    let status = 502;
    const { app, headers, logoRequests } = await start(() =>
      status === 200
        ? new Response(PNG, { headers: { "Content-Type": "image/png" } })
        : new Response("bad gateway", { status }),
    );

    const failed = await app.inject({ method: "GET", url: "/api/images/dispatcharr/logo/7", headers });
    expect(failed.statusCode).toBe(502);
    status = 200;
    const ok = await app.inject({ method: "GET", url: "/api/images/dispatcharr/logo/7", headers });
    expect(ok.statusCode).toBe(200);
    expect(logoRequests).toEqual(["7", "7"]);
  });
});
