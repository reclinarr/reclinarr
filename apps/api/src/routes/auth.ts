import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { sessionCookieSecure } from "../config.js";
import { isDemoSession, requireAuth } from "../plugins/auth.js";
import { SESSION_COOKIE } from "../services/session.js";
import { releaseLivePlayback } from "../services/live-playback.js";
import { JellyfinProvider, MockJellyfinProvider } from "@reclinarr/providers";
import { createHash } from "node:crypto";

const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  deviceId: z.string().min(8),
  deviceName: z.string().min(1).default("Reclinarr Web"),
});

function jellyfinDeviceId(clientDeviceId: string, username: string): string {
  return createHash("sha256").update(`${clientDeviceId}:${username}`).digest("hex").slice(0, 32);
}

export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = LoginBody.parse(req.body);
      const deviceId = jellyfinDeviceId(body.deviceId, body.username);

      let authResult: {
        userId: string;
        username: string;
        accessToken: string;
      };

      if (ctx.jellyfin instanceof MockJellyfinProvider) {
        const err = new Error(
          "API is in mock mode — set RECLINARR_USE_MOCKS=false and JELLYFIN_URL to use real Jellyfin",
        ) as Error & { statusCode: number };
        err.statusCode = 503;
        throw err;
      }
      if (!(ctx.jellyfin instanceof JellyfinProvider)) {
        throw new Error("Jellyfin provider missing authenticate");
      }
      try {
        authResult = await ctx.jellyfin.authenticate({
          username: body.username,
          password: body.password,
          deviceId,
          deviceName: body.deviceName,
        });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 401) {
          const rejected = new Error("Wrong Jellyfin username or password") as Error & {
            statusCode: number;
          };
          rejected.statusCode = 401;
          throw rejected;
        }
        throw err;
      }

      const session = await ctx.sessions.create({
        jellyfinUserId: authResult.userId,
        jellyfinUsername: authResult.username,
        jellyfinAccessToken: authResult.accessToken,
        deviceId,
        deviceName: body.deviceName,
      });

      reply.setCookie(SESSION_COOKIE, session.id, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: sessionCookieSecure(ctx.config),
        maxAge: 60 * 60 * 24 * 14,
      });

      return {
        user: {
          id: session.jellyfinUserId,
          username: session.jellyfinUsername,
          demo: isDemoSession(ctx, session),
        },
        sessionId: session.id,
      };
    },
  );

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.session && req.userContext) {
      releaseLivePlayback(ctx, req.session.id);
      await ctx.sessions.destroy(req.session.id);
      // Revoke the Jellyfin token too, so a copied session or token stops working upstream.
      await ctx.jellyfin.logout(req.userContext).catch((err: unknown) => {
        req.log.warn({ err }, "could not revoke the Jellyfin token on logout");
      });
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => {
    const { session } = await requireAuth(req);
    return {
      user: {
        id: session.jellyfinUserId,
        username: session.jellyfinUsername,
        demo: isDemoSession(ctx, session),
      },
      mocks: ctx.useMocks,
    };
  });
}
