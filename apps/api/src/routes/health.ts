import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";

export async function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  /** Public liveness — no provider details. */
  app.get("/api/health", async () => ({
    status: "ok",
    service: "reclinarr",
  }));

  /** Authenticated provider posture for operators / UI. */
  app.get("/api/health/providers", async (req) => {
    await requireAuth(req);
    const results = await Promise.all(
      ctx.providers.map(async (p) => {
        try {
          return await p.health();
        } catch (err) {
          return {
            id: p.id,
            status: "down" as const,
            message: err instanceof Error ? err.message : String(err),
            capabilities: p.capabilities(),
          };
        }
      }),
    );

    const overall = results.every((r) => r.status === "ok" || r.status === "unconfigured")
      ? "ok"
      : results.some((r) => r.status === "ok")
        ? "degraded"
        : "down";

    return {
      status: overall,
      service: "reclinarr",
      mocks: ctx.useMocks,
      providers: results,
    };
  });
}
