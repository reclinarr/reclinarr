import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { createAppContext } from "./context.js";
import { buildApp } from "./app.js";
import { startHlsPackager } from "./services/hls-packager.js";

// Load monorepo root .env (apps/api/../../.env)
loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv({ path: resolve(process.cwd(), ".env") });

async function main() {
  const config = loadConfig();
  const ctx = createAppContext(config);
  const app = await buildApp(ctx);

  // Local/dev: embed packager. Docker runs a dedicated packager process.
  const embedPackager = config.RECLINARR_EMBED_PACKAGER !== false;
  if (embedPackager) {
    startHlsPackager(config.RECLINARR_DATA_DIR, {
      listActive: () => ctx.acquisitions.listPackagerJobs(),
      markHlsReady: (id) => ctx.acquisitions.markHlsReady(id),
    });
    app.log.info("embedded HLS packager started");
  }

  // nginx media plane: bind loopback so only nginx is public.
  const host = config.RECLINARR_MEDIA_PLANE === "nginx" ? "127.0.0.1" : "0.0.0.0";
  await app.listen({ port: config.RECLINARR_PORT, host });
  app.log.info(
    {
      port: config.RECLINARR_PORT,
      host,
      mediaPlane: config.RECLINARR_MEDIA_PLANE,
      mocks: ctx.useMocks,
      jellyfin: config.JELLYFIN_URL || null,
      seerr: config.SEERR_URL || null,
      dispatcharr: config.DISPATCHARR_URL || null,
    },
    "Reclinarr API listening",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
