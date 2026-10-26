import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import { preferencesPatchSchema } from "../services/preferences.js";

export async function registerPreferencesRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/preferences", async (req) => {
    const { session } = await requireAuth(req);
    const stored = ctx.preferences.find(session.jellyfinUserId);
    return { preferences: stored ?? ctx.preferences.get(session.jellyfinUserId), saved: stored != null };
  });

  app.put("/api/preferences", async (req) => {
    const { session } = await requireAuth(req);
    const patch = preferencesPatchSchema.parse(req.body);
    return { preferences: ctx.preferences.update(session.jellyfinUserId, patch), saved: true };
  });
}
