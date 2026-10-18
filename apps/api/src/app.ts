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

function corsOrigins(publicUrl: string): true | string[] {
  try {
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
  } catch {
    return true;
  }
}

export async function buildApp(ctx: AppContext) {
  const app = Fastify({
    logger: {
      level: "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "*.password",
          "*.accessToken",
          "*.jellyfinAccessToken",
          "*.apiKey",
        ],
        remove: true,
      },
    },
    genReqId: () => randomUUID(),
  });

  await app.register(cors, {
    origin: corsOrigins(ctx.config.RECLINARR_PUBLIC_URL),
    credentials: true,
  });
  await app.register(cookie, {
    secret: ctx.config.RECLINARR_SESSION_SECRET,
  });
  await app.register(rateLimit, {
    global: false,
  });

  await registerAuth(app, ctx);
  await registerHealthRoutes(app, ctx);
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
