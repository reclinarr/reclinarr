import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import { probeSetupService } from "../setup-probe.js";
import { readSetupConfig, writeSetupConfig } from "../setup-store.js";
import {
  ServiceEditError,
  ServiceEditSchema,
  applyServiceEdit,
  describeServices,
  envLockedKeys,
  probeInputFor,
  serviceDefinition,
} from "../services/service-settings.js";

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

async function isAdmin(ctx: AppContext, req: FastifyRequest): Promise<boolean> {
  const { userContext } = await requireAuth(req);
  return ctx.jellyfin.isAdministrator(userContext);
}

async function requireAdmin(ctx: AppContext, req: FastifyRequest): Promise<void> {
  if (!(await isAdmin(ctx, req))) throw httpError("Only Jellyfin administrators can change services", 403);
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  onSaved: () => void,
): Promise<void> {
  const limited = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  app.get("/api/admin/services", async (req) => {
    if (!(await isAdmin(ctx, req))) return { admin: false as const };
    return { admin: true as const, services: describeServices(ctx.config, process.env) };
  });

  app.post<{ Params: { service: string } }>("/api/admin/services/:service/test", limited, async (req) => {
    await requireAdmin(ctx, req);
    const service = serviceDefinition(req.params.service);
    if (!service) throw httpError("Unknown service", 404);
    const edit = ServiceEditSchema.parse(req.body);
    return probeSetupService(probeInputFor(service, edit, ctx.config, envLockedKeys(process.env)));
  });

  app.put<{ Params: { service: string } }>("/api/admin/services/:service", limited, async (req, reply) => {
    await requireAdmin(ctx, req);
    const service = serviceDefinition(req.params.service);
    if (!service) throw httpError("Unknown service", 404);
    const edit = ServiceEditSchema.parse(req.body);
    let next: Record<string, string>;
    try {
      next = applyServiceEdit(service, edit, readSetupConfig(ctx.config.RECLINARR_DATA_DIR), envLockedKeys(process.env));
    } catch (err) {
      if (err instanceof ServiceEditError) throw httpError(err.message, err.statusCode);
      throw err;
    }
    writeSetupConfig(ctx.config.RECLINARR_DATA_DIR, next);
    // Reload only once the reply is flushed: it closes this server.
    reply.raw.once("finish", onSaved);
    return reply.send({ saved: true });
  });
}
