import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { SESSION_COOKIE, SESSION_HEADER, type SessionRecord } from "../services/session.js";
import type { UserContext } from "@reclinarr/providers";

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionRecord;
    userContext?: UserContext;
  }
}

function sessionIdFromRequest(req: FastifyRequest): string | undefined {
  const fromCookie = req.cookies[SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.headers[SESSION_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader?.trim()) return fromHeader.trim();
  // React Native Image often cannot attach custom headers; TV artwork uses ?reclinarr_session=.
  const query = req.query as Record<string, unknown> | undefined;
  const fromQuery = query?.[SESSION_COOKIE];
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  const part = raw.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${SESSION_COOKIE}=`));
  return part?.slice(SESSION_COOKIE.length + 1) || undefined;
}

function toUserContext(session: SessionRecord): UserContext {
  return {
    jellyfinUserId: session.jellyfinUserId,
    jellyfinAccessToken: session.jellyfinAccessToken,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
  };
}

export async function registerAuth(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.decorateRequest("session", undefined);
  app.decorateRequest("userContext", undefined);

  app.addHook("preHandler", async (req) => {
    const sid = sessionIdFromRequest(req);
    if (!sid) return;
    const session = await ctx.sessions.get(sid);
    if (!session) return;
    req.session = session;
    req.userContext = toUserContext(session);
  });
}

export async function requireAuth(req: FastifyRequest): Promise<{
  session: SessionRecord;
  userContext: UserContext;
}> {
  if (!req.session || !req.userContext) {
    const err = new Error("Unauthorized") as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
  return { session: req.session, userContext: req.userContext };
}
