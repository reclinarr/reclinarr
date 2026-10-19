import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { ensureSetupToken, writeSetupConfig } from "../setup-store.js";

const SetupSchema = z.object({
  setupCode: z.string().min(1),
  JELLYFIN_URL: z.string().url(),
  SEERR_URL: z.string().url().optional().or(z.literal("")),
  SEERR_API_KEY: z.string().optional(),
  DISPATCHARR_URL: z.string().url().optional().or(z.literal("")),
  DISPATCHARR_API_KEY: z.string().optional(),
  DISPATCHARR_USERNAME: z.string().optional(),
  DISPATCHARR_PASSWORD: z.string().optional(),
  BAZARR_URL: z.string().url().optional().or(z.literal("")),
  BAZARR_API_KEY: z.string().optional(),
});

export async function registerSetupRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const setupRequired = !ctx.config.JELLYFIN_URL.trim() && !ctx.config.RECLINARR_USE_MOCKS;
  const setupCode = ensureSetupToken(ctx.config.RECLINARR_DATA_DIR);
  if (setupRequired) app.log.warn({ setupCode }, "first-run setup code");

  app.get("/api/setup/status", async () => ({ setupRequired }));
  app.post("/api/setup", async (req, reply) => {
    if (!setupRequired) return reply.code(409).send({ error: "Setup is already complete" });
    const body = SetupSchema.parse(req.body);
    const supplied = Buffer.from(body.setupCode);
    const expected = Buffer.from(setupCode);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(403).send({ error: "Setup code is incorrect" });
    }
    const { setupCode: _code, ...values } = body;
    writeSetupConfig(ctx.config.RECLINARR_DATA_DIR, values);
    return reply.send({ saved: true, restartRequired: true });
  });
}
