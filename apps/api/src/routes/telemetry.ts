import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";

const MetricSchema = z.object({
  event: z.enum([
    "client.api_operation",
    "client.screen_view",
    "client.playback_milestone",
    "client.artwork_result",
  ]),
  properties: z.record(z.string(), z.unknown()),
});

const BatchSchema = z.object({ events: z.array(MetricSchema).max(50) });

export async function registerTelemetryRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Clients bundle the public project token and send their own events. This flag
  // only applies the installation-wide opt-out; server capture still needs a key.
  app.get("/api/telemetry/status", async () => ({ enabled: !ctx.config.RECLINARR_TELEMETRY_DISABLED }));

  app.post(
    "/api/telemetry/events",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      await requireAuth(req); // Account identifiers are never emitted.
      const distinctId = req.headers["x-reclinarr-telemetry-id"];
      const platform = req.headers["x-reclinarr-client-platform"];
      const payload = BatchSchema.parse(req.body);
      if (typeof distinctId !== "string" || typeof platform !== "string" || !["web", "ios", "android"].includes(platform)) {
        return reply.status(400).send({ error: "Invalid telemetry context" });
      }
      ctx.telemetry.captureClientBatch(distinctId, payload.events, platform);
      return { accepted: ctx.telemetry.enabled ? payload.events.length : 0 };
    },
  );
}
