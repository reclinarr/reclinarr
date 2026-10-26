import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { createAppContext } from "./context.js";
import { buildApp } from "./app.js";
import { startHlsPackager } from "./services/hls-packager.js";
import { readSetupConfig } from "./setup-store.js";

// Load monorepo root .env (apps/api/../../.env)
loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv({ path: resolve(process.cwd(), ".env") });

type Server = Awaited<ReturnType<typeof start>>;

async function start(onSetupSaved: () => void) {
  const dataDir = process.env.RECLINARR_DATA_DIR || "./data";
  const config = loadConfig(process.env, readSetupConfig(dataDir));
  const ctx = createAppContext(config);
  const app = await buildApp(ctx, { onSetupSaved });

  // Local/dev: embed packager. Docker runs a dedicated packager process.
  const embedPackager = config.RECLINARR_EMBED_PACKAGER !== false;
  const packager = embedPackager
    ? startHlsPackager(config.RECLINARR_DATA_DIR, {
        listActive: () => ctx.acquisitions.listPackagerJobs(),
        markHlsReady: (id) => ctx.acquisitions.markHlsReady(id),
      })
    : null;
  if (packager) app.log.info("embedded HLS packager started");

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
  return { ctx, app, packager };
}

async function stop({ ctx, app, packager }: Server) {
  await app.close();
  packager?.stop();
  ctx.close();
}

function fatal(err: unknown) {
  console.error(err);
  process.exit(1);
}

async function main() {
  let reloading = false;
  // Setup saves settings to the data dir; rebuild everything from them in-process so the
  // wizard works the same under `make dev`, Docker Compose and a plain `docker run`.
  const reload = () => {
    if (reloading) return;
    reloading = true;
    server.app.log.info("setup saved, reloading with the new settings");
    stop(server)
      .then(() => start(reload))
      .then((next) => {
        server = next;
        reloading = false;
      })
      .catch(fatal);
  };
  let server: Server = await start(reload);
}

main().catch(fatal);
