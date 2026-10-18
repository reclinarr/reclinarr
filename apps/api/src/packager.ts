import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { createAppContext } from "./context.js";
import { startHlsPackager } from "./services/hls-packager.js";

loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv({ path: resolve(process.cwd(), ".env") });

async function main() {
  const config = loadConfig();
  if (config.FFMPEG_PATH) process.env.FFMPEG_PATH = config.FFMPEG_PATH;
  if (config.FFPROBE_PATH) process.env.FFPROBE_PATH = config.FFPROBE_PATH;

  const ctx = createAppContext(config);
  const packager = startHlsPackager(
    config.RECLINARR_DATA_DIR,
    {
      listActive: () => ctx.acquisitions.listPackagerJobs(),
      markHlsReady: (id) => ctx.acquisitions.markHlsReady(id),
    },
    { keepProcessAlive: true },
  );

  console.info("[packager] HLS packager running", {
    dataDir: config.RECLINARR_DATA_DIR,
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
