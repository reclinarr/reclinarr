import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootEnvPath = fileURLToPath(new URL("../.env", import.meta.url));
let rootEnv = "";
try {
  rootEnv = readFileSync(rootEnvPath, "utf8");
} catch {
  // CI and production builds can provide EXPO_PUBLIC_POSTHOG_PROJECT_KEY directly.
}

const values = Object.fromEntries(
  rootEnv.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) return [];
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    return [[match[1], value]];
  }),
);

process.env.EXPO_PUBLIC_POSTHOG_PROJECT_KEY ??=
  values.EXPO_PUBLIC_POSTHOG_PROJECT_KEY ?? values.RECLINARR_POSTHOG_PROJECT_KEY ?? "";

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Usage: with-expo-env.mjs <command> [...args]");

const child = spawn(command, args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
