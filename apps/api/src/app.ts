import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";
import type { AppContext } from "./context.js";
import { registerAuth } from "./plugins/auth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerHomeRoutes } from "./routes/home.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerPlaybackRoutes } from "./routes/playback.js";
import { registerImageRoutes } from "./routes/images.js";
import { registerDiscoverRoutes } from "./routes/discover.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerRequestRoutes } from "./routes/request.js";
import { registerAcquisitionRoutes } from "./routes/acquisition.js";
import { registerLiveRoutes } from "./routes/live.js";
import { registerLibraryRoutes } from "./routes/library.js";
import { registerMyListRoutes } from "./routes/mylist.js";
import { registerPreferencesRoutes } from "./routes/preferences.js";
import { registerSetupRoutes } from "./routes/setup.js";
import { registerTelemetryRoutes } from "./routes/telemetry.js";

function corsOrigins(publicUrl: string): string[] {
  const u = new URL(publicUrl);
  const origins = new Set<string>([u.origin]);
  // Dev: Vite/Expo web often sits on 5173 while the API is on RECLINARR_PUBLIC_URL.
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
    origins.add("http://localhost:8081");
    origins.add("http://127.0.0.1:8081");
    origins.add(`http://localhost:${u.port || "8787"}`);
    origins.add(`http://127.0.0.1:${u.port || "8787"}`);
  }
  return [...origins];
}

export async function buildApp(ctx: AppContext, opts: { onSetupSaved: () => void }) {
  const requestStarted = new WeakMap<object, bigint>();
  const app = Fastify({
    logger: {
      level: "info",
      redact: {
        paths: [
          "*.password",
          "*.accessToken",
          "*.jellyfinAccessToken",
          "*.apiKey",
        ],
        remove: true,
      },
      serializers: {
        // Query strings can carry ?reclinarr_session= (TV artwork), so log the path only.
        req: (req) => ({
          method: req.method,
          url: req.url.split("?")[0],
          host: req.host,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        }),
      },
    },
    genReqId: () => randomUUID(),
    trustProxy: [
      "loopback",
      ...ctx.config.RECLINARR_TRUSTED_PROXIES.split(",").map((s) => s.trim()).filter(Boolean),
    ],
  });

  await app.register(cors, {
    origin: corsOrigins(ctx.config.RECLINARR_PUBLIC_URL),
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
  });

  app.addHook("onRequest", (req, _reply, done) => {
    requestStarted.set(req, process.hrtime.bigint());
    const header = req.headers["x-reclinarr-telemetry-id"];
    const distinctId = Array.isArray(header) ? header[0] : header;
    const platformHeader = req.headers["x-reclinarr-client-platform"];
    const versionHeader = req.headers["x-reclinarr-client-version"];
    const sessionHeader = req.headers["x-reclinarr-telemetry-session"];
    const deviceHeader = req.headers["x-reclinarr-client-device"];
    const platform = Array.isArray(platformHeader) ? platformHeader[0] : platformHeader;
    const appVersion = Array.isArray(versionHeader) ? versionHeader[0] : versionHeader;
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    const deviceType = Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader;
    ctx.telemetry.runWithDistinctId(
      typeof distinctId === "string" ? distinctId : null,
      done,
      {
        ...(typeof platform === "string" ? { platform } : {}),
        ...(typeof appVersion === "string" ? { appVersion } : {}),
        ...(typeof sessionId === "string" ? { sessionId } : {}),
        ...(typeof deviceType === "string" ? { deviceType } : {}),
      },
    );
  });
  // Baseline browser protections for every response, including the web app: no MIME sniffing,
  // no framing by other sites (clickjacking), and no session-bearing URLs leaked as Referer.
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("Referrer-Policy", "same-origin");
    if (!reply.hasHeader("Content-Security-Policy")) {
      reply.header("Content-Security-Policy", "frame-ancestors 'self'");
    }
    return payload;
  });
  app.addHook("onResponse", (req, reply) => {
    if (!req.session) return;
    const operation = apiMetricOperation(req.routeOptions.url ?? "");
    if (!operation) return;
    const started = requestStarted.get(req);
    const durationMs = started == null
      ? 0
      : Math.max(0, Math.round(Number(process.hrtime.bigint() - started) / 1_000_000));
    ctx.telemetry.captureCurrent("server.api_operation", {
      operation,
      method: req.method,
      duration_ms: durationMs,
      status: reply.statusCode,
      outcome: reply.statusCode < 400 ? "success" : "failure",
    });
  });

  await registerAuth(app, ctx);
  await registerHealthRoutes(app, ctx);
  await registerSetupRoutes(app, ctx, opts.onSetupSaved);
  await registerTelemetryRoutes(app, ctx);
  await registerAdminRoutes(app, ctx, opts.onSetupSaved);
  await registerAuthRoutes(app, ctx);
  await registerHomeRoutes(app, ctx);
  await registerMediaRoutes(app, ctx);
  await registerDiscoverRoutes(app, ctx);
  await registerCatalogRoutes(app, ctx);
  await registerRequestRoutes(app, ctx);
  await registerAcquisitionRoutes(app, ctx);
  await registerLibraryRoutes(app, ctx);
  await registerLiveRoutes(app, ctx);
  await registerMyListRoutes(app, ctx);
  await registerPreferencesRoutes(app, ctx);
  await registerPlaybackRoutes(app, ctx);
  await registerImageRoutes(app, ctx);

  const webDist = join(process.cwd(), "apps/web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) {
        return reply.status(404).send({ error: "Not found", requestId: req.id });
      }
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: "Invalid request",
        requestId: req.id,
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }
    const error = err as Error & { statusCode?: number; code?: string };
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err, requestId: req.id }, "request failed");
      reply.status(status).send({
        error: "Internal Server Error",
        requestId: req.id,
      });
      return;
    }
    req.log.warn({ err, requestId: req.id }, "request rejected");
    reply.status(status).send({
      error: error.message || "Request rejected",
      requestId: req.id,
    });
  });

  return app;
}

function apiMetricOperation(route: string): string | null {
  if (route === "/api/home") return "home";
  if (route.startsWith("/api/catalog")) return "catalog";
  if (route.startsWith("/api/discover")) return "discover";
  if (route.startsWith("/api/media/")) return "media_details";
  if (route.startsWith("/api/search")) return "search";
  if (route.startsWith("/api/playback/resolve")) return "playback_resolve";
  if (route === "/api/playback/bandwidth-probe") return "bandwidth_probe";
  if (route.startsWith("/api/live/")) return "live";
  if (route.startsWith("/api/acquisition")) return "acquisition";
  if (route.startsWith("/api/requests") || route === "/api/request") return "requests";
  if (route.startsWith("/api/library")) return "library";
  if (route.startsWith("/api/mylist")) return "my_list";
  return null;
}
