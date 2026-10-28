/**
 * Bump every workspace and Expo app to one version, then commit it.
 * Usage: node scripts/release.mjs 0.2.0   (or: make release VERSION=0.2.0)
 * Tagging and pushing stay manual: CI publishes the image when the v* tag lands.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  console.error("Usage: node scripts/release.mjs <x.y.z[-prerelease]>");
  process.exit(1);
}

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

if (run("git", ["status", "--porcelain"]).trim()) {
  console.error("Working tree is not clean; commit or stash first.");
  process.exit(1);
}

run("npm", ["version", version, "--workspaces", "--include-workspace-root", "--no-git-tag-version"]);

const appConfigs = ["apps/web/app.json", "apps/mobile/app.json", "apps/tv/app.json"];
for (const rel of appConfigs) {
  const path = resolve(root, rel);
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.expo.version = version;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

run("git", ["add", "-u"]);
run("git", ["commit", "-m", `Release v${version}`]);

console.log(`Committed v${version}. Publish with:\n  git tag v${version} && git push origin HEAD v${version}`);
