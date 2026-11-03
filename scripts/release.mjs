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

// Android only installs an update whose versionCode is not lower, so it must grow with
// semver: each prerelease sorts below its final (99) and below the next patch.
function androidVersionCode(v) {
  const [core, pre] = v.split(/-(.*)/s);
  const [major, minor, patch] = core.split(".").map(Number);
  const preNumber = pre === undefined ? 99 : Number(/(\d+)\D*$/.exec(pre)?.[1] ?? 0);
  if (minor > 99 || patch > 99 || (pre !== undefined && preNumber > 98)) {
    console.error(`Cannot map ${v} to an Android versionCode: minor and patch must be < 100, the prerelease number < 99.`);
    process.exit(1);
  }
  return ((major * 100 + minor) * 100 + patch) * 100 + preNumber;
}

const tvVersionCode = androidVersionCode(version);

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
  if (rel === "apps/tv/app.json") config.expo.android.versionCode = tvVersionCode;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

run("git", ["add", "-u"]);
run("git", ["commit", "-m", `Release v${version}`]);

console.log(`Committed v${version}. Publish with:\n  git tag v${version} && git push origin HEAD v${version}`);
