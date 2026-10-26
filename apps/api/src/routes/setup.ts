import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { probeSetupService } from "../setup-probe.js";
import { ensureSetupToken, readSetupConfig, writeSetupConfig } from "../setup-store.js";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const SetupSchema = z.object({
  setupCode: z.string().min(1),
  JELLYFIN_URL: z.string().url(),
  SEERR_URL: optionalUrl,
  SEERR_API_KEY: z.string().optional(),
  DISPATCHARR_URL: optionalUrl,
  DISPATCHARR_API_KEY: z.string().optional(),
  DISPATCHARR_USERNAME: z.string().optional(),
  DISPATCHARR_PASSWORD: z.string().optional(),
  BAZARR_URL: optionalUrl,
  BAZARR_API_KEY: z.string().optional(),
  RECLINARR_TELEMETRY_DISABLED: z.enum(["true", "false"]).optional(),
});

const TestSchema = z.discriminatedUnion("service", [
  z.object({ setupCode: z.string().min(1), service: z.literal("code") }),
  z.object({
    setupCode: z.string().min(1),
    service: z.literal("jellyfin"),
    JELLYFIN_URL: z.string().optional(),
  }),
  z.object({
    setupCode: z.string().min(1),
    service: z.literal("seerr"),
    SEERR_URL: z.string().optional(),
    SEERR_API_KEY: z.string().optional(),
  }),
  z.object({
    setupCode: z.string().min(1),
    service: z.literal("dispatcharr"),
    DISPATCHARR_URL: z.string().optional(),
    DISPATCHARR_API_KEY: z.string().optional(),
    DISPATCHARR_USERNAME: z.string().optional(),
    DISPATCHARR_PASSWORD: z.string().optional(),
  }),
  z.object({
    setupCode: z.string().min(1),
    service: z.literal("bazarr"),
    BAZARR_URL: z.string().optional(),
    BAZARR_API_KEY: z.string().optional(),
  }),
]);

function codesMatch(supplied: string, expected: string): boolean {
  const given = Buffer.from(supplied);
  const actual = Buffer.from(expected);
  return given.length === actual.length && timingSafeEqual(given, actual);
}

export async function registerSetupRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  onSaved: () => void,
): Promise<void> {
  const setupRequired = !ctx.config.JELLYFIN_URL.trim() && !ctx.config.RECLINARR_USE_MOCKS;
  const setupCode = ensureSetupToken(ctx.config.RECLINARR_DATA_DIR);
  if (setupRequired) app.log.warn({ setupCode }, "first-run setup code");

  app.get("/api/setup/status", async () => ({ setupRequired }));

  // The setup code gates connection tests so this open route cannot probe arbitrary hosts.
  app.post("/api/setup/test", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!setupRequired) return reply.code(409).send({ error: "Setup is already complete" });
    const body = TestSchema.parse(req.body);
    if (!codesMatch(body.setupCode, setupCode)) {
      return reply.code(403).send({ error: "Setup code is incorrect" });
    }
    if (body.service === "code") return reply.send({ ok: true, message: "Setup code matches." });
    return reply.send(await probeSetupService(body));
  });

  app.post("/api/setup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!setupRequired) return reply.code(409).send({ error: "Setup is already complete" });
    const body = SetupSchema.parse(req.body);
    if (!codesMatch(body.setupCode, setupCode)) {
      return reply.code(403).send({ error: "Setup code is incorrect" });
    }
    const { setupCode: _code, ...entered } = body;
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(entered)) {
      if (typeof value === "string") values[key] = value;
    }
    const existing = readSetupConfig(ctx.config.RECLINARR_DATA_DIR);
    writeSetupConfig(ctx.config.RECLINARR_DATA_DIR, { ...existing, ...values });
    // Reload only once the reply is flushed: it closes this server.
    reply.raw.once("finish", onSaved);
    return reply.send({ saved: true });
  });
}
