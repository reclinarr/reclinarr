import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { createPackagerContext } from "./context.js";
import { startHlsPackager } from "./services/hls-packager.js";

loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv({ path: resolve(process.cwd(), ".env") });

async function main() {
  const config = loadConfig();
  const ctx = createPackagerContext(config);
  const packager = startHlsPackager(
    ctx.dataDir,
    {
      listActive: () => ctx.acquisitions.listPackagerJobs(),
      markHlsReady: (id) => ctx.acquisitions.markHlsReady(id),
    },
    { keepProcessAlive: true },
  );

  console.info("[packager] HLS packager running", {
    dataDir: ctx.dataDir,
  });

  const shutdown = () => {
    packager.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
