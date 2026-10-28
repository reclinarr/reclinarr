import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createAppContext, type AppContext } from "../context.js";

let open: Array<{ ctx: AppContext; app: Awaited<ReturnType<typeof buildApp>> }> = [];
afterEach(async () => {
  for (const { ctx, app } of open) {
    await app.close();
    ctx.close();
  }
  open = [];
});

async function start(env: Record<string, string> = {}) {
  const dir = env.RECLINARR_DATA_DIR ?? mkdtempSync(join(tmpdir(), "reclinarr-setup-"));
  const ctx = createAppContext(loadConfig({ RECLINARR_DATA_DIR: dir, ...env }));
  const app = await buildApp(ctx, { onSetupSaved: vi.fn() });
  open.push({ ctx, app });
  return { app, dir };
}

describe("first-run setup", () => {
  it("deletes the setup code once setup is saved and stores the address normalized", async () => {
    const { app, dir } = await start();
    const tokenPath = join(dir, "setup-token");
    const setupCode = readFileSync(tokenPath, "utf8").trim();

    const res = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { setupCode, JELLYFIN_URL: "https://JF.example.com/jellyfin/" },
    });
    expect(res.statusCode).toBe(200);
    expect(existsSync(tokenPath)).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).JELLYFIN_URL).toBe("https://jf.example.com/jellyfin");
  });

  it("rejects an address with a line break", async () => {
    const { app, dir } = await start();
    const setupCode = readFileSync(join(dir, "setup-token"), "utf8").trim();
    const res = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { setupCode, JELLYFIN_URL: "https://jf.example.com\n/x" },
    });
    expect(res.statusCode).toBe(400);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });

  it("removes a leftover setup code once setup is complete", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reclinarr-setup-"));
    writeFileSync(join(dir, "setup-token"), "old-code\n");
    await start({ RECLINARR_DATA_DIR: dir, JELLYFIN_URL: "https://jf.example.com" });
    expect(existsSync(join(dir, "setup-token"))).toBe(false);
  });
});
