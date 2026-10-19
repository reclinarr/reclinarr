import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** First-run secrets live in a private file inside the configured data directory. */
export function setupConfigPath(dataDir: string): string {
  return join(dataDir, "config.json");
}

export function readSetupConfig(dataDir: string): Record<string, string> {
  const path = setupConfigPath(dataDir);
  if (!existsSync(path)) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? value as Record<string, string> : {};
  } catch {
    throw new Error(`Unable to read setup configuration at ${path}`);
  }
}

export function writeSetupConfig(dataDir: string, values: Record<string, string>): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const path = setupConfigPath(dataDir);
  writeFileSync(path, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function ensureSetupToken(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const path = join(dataDir, "setup-token");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const token = cryptoRandomToken();
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return token;
}

function cryptoRandomToken(): string {
  return randomBytes(24).toString("hex");
}
