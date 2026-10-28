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
  // The explicit header wins: a cookie can be planted by another origin on the same host
  // (cookies ignore ports), and on plain-HTTP deployments the client's own Secure cookie is dropped.
  const header = req.headers[SESSION_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader?.trim()) return fromHeader.trim();
  const fromCookie = req.cookies[SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  // React Native Image often cannot attach custom headers; TV artwork uses ?reclinarr_session=.
  const query = req.query as Record<string, unknown> | undefined;
  const fromQuery = query?.[SESSION_COOKIE];
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();
  return undefined;
}

function toUserContext(session: SessionRecord): UserContext {
  return {
    jellyfinUserId: session.jellyfinUserId,
    jellyfinAccessToken: session.jellyfinAccessToken,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
  };
}

/** How long a session may go without re-checking its Jellyfin token. */
export const SESSION_REVALIDATE_MS = 5 * 60 * 1000;

export async function registerAuth(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.decorateRequest("session", undefined);
  app.decorateRequest("userContext", undefined);

  // Jellyfin is the identity authority: a session dies when Jellyfin stops accepting its token
  // (password reset, disabled or deleted user, revoked device), not only at the 14-day expiry.
  const validatedAt = new Map<string, number>();

  app.addHook("preHandler", async (req) => {
    const sid = sessionIdFromRequest(req);
    if (!sid) return;
    const session = await ctx.sessions.get(sid);
    if (!session) return;
    const userContext = toUserContext(session);

    const now = Date.now();
    const lastChecked = Math.max(validatedAt.get(session.id) ?? 0, session.createdAt.getTime());
    if (now - lastChecked > SESSION_REVALIDATE_MS) {
      try {
        const valid = await ctx.jellyfin.isTokenValid(userContext);
        if (!valid) {
          validatedAt.delete(session.id);
          await ctx.sessions.destroy(session.id);
          req.log.info({ userId: session.jellyfinUserId }, "session ended: Jellyfin rejected its token");
          return;
        }
      } catch (err) {
        // Jellyfin unreachable: keep the session rather than logging everyone out; retry next window.
        req.log.warn({ err }, "session revalidation against Jellyfin failed");
      }
      validatedAt.set(session.id, now);
    }

    req.session = session;
    req.userContext = userContext;
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

export function isDemoSession(ctx: AppContext, session: SessionRecord): boolean {
  const username = session.jellyfinUsername.toLowerCase();
  return ctx.config.RECLINARR_DEMO_USERS.split(",").some(
    (entry) => entry.trim().toLowerCase() === username,
  );
}

/** `requireAuth` that also refuses demo accounts (requests and IPTV downloads). */
export async function requireFullAccess(
  ctx: AppContext,
  req: FastifyRequest,
): Promise<{ session: SessionRecord; userContext: UserContext }> {
  const auth = await requireAuth(req);
  if (isDemoSession(ctx, auth.session)) {
    throw Object.assign(new Error("Not available on the demo account"), { statusCode: 403 });
  }
  return auth;
}
