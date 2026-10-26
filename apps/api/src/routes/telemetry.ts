import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export async function registerTelemetryRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Clients bundle the public project token and send their own events. This flag
  // only applies the installation-wide opt-out; server capture still needs a key.
  app.get("/api/telemetry/status", async () => ({ enabled: !ctx.config.RECLINARR_TELEMETRY_DISABLED }));
}
