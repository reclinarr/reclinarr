// Bundles the API server and HLS packager into single ESM files for the Docker image, so the
// runtime ships without node_modules apart from better-sqlite3's native binding.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

await build({
  entryPoints: ["src/server.ts", "src/packager.ts"],
  outdir: "dist/bundle",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["better-sqlite3"],
  define: { RECLINARR_BUNDLED_VERSION: JSON.stringify(version) },
  // Fastify and other CommonJS dependencies call require() for Node built-ins.
  banner: {
    js: 'import { createRequire as __bundleCreateRequire } from "node:module"; const require = __bundleCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});
