import {
  configureClient,
  createClient,
  type KeyValueStorage,
  type ReclinarrClient,
} from "@reclinarr/client";

export const SERVER_URL_KEY = "reclinarr.serverUrl";
export const SESSION_KEY = "reclinarr.sessionId";

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.startsWith("127.") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
  );
}

export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol === "http:" && !isPrivateHost(url.hostname)) {
      return `https://${url.host}${url.pathname}`.replace(/\/$/, "") || `https://${url.host}`;
    }
    return url.origin;
  } catch {
    return withScheme;
  }
}

export async function loadServerUrl(storage: KeyValueStorage): Promise<string | null> {
  const raw = await storage.getItem(SERVER_URL_KEY);
  if (!raw) return null;
  const normalized = normalizeServerUrl(raw);
  if (normalized !== raw) await storage.setItem(SERVER_URL_KEY, normalized);
  return normalized;
}

export async function saveServerUrl(storage: KeyValueStorage, url: string): Promise<string> {
  const normalized = normalizeServerUrl(url);
  await storage.setItem(SERVER_URL_KEY, normalized);
  return normalized;
}

export async function clearSession(storage: KeyValueStorage): Promise<void> {
  await storage.removeItem?.(SESSION_KEY);
}

export function attachClient(
  storage: KeyValueStorage,
  baseUrl: string,
  appVersion?: string,
): ReclinarrClient {
  return configureClient({
    baseUrl,
    credentials: "include",
    storage,
    appVersion,
    getSessionId: () => storage.getItem(SESSION_KEY),
    setSessionId: async (id) => {
      if (id) await storage.setItem(SESSION_KEY, id);
      else await storage.removeItem?.(SESSION_KEY);
    },
  });
}

export async function probeServer(url: string): Promise<void> {
  const origin = normalizeServerUrl(url);
  const client = createClient({ baseUrl: origin });
  const health = await client.health();
  if (health.status !== "ok") {
    throw new Error("That server is not Reclinarr");
  }
}
