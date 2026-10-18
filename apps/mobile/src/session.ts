import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ReclinarrClient } from "@reclinarr/client";
import {
  attachClient as attach,
  clearSession as clear,
  loadServerUrl as load,
  probeServer,
  saveServerUrl as save,
} from "@reclinarr/native-ui";

export { SERVER_URL_KEY, SESSION_KEY, probeServer } from "@reclinarr/native-ui";

export async function loadServerUrl(): Promise<string | null> {
  return load(AsyncStorage);
}

export async function saveServerUrl(url: string): Promise<string> {
  return save(AsyncStorage, url);
}

export async function clearSession(): Promise<void> {
  return clear(AsyncStorage);
}

export function attachClient(baseUrl: string): ReclinarrClient {
  return attach(AsyncStorage, baseUrl);
}

/** Re-attach after Metro reload / cold start so login sessions are stored. */
export async function ensureClient(): Promise<string | null> {
  const url = await loadServerUrl();
  if (!url) return null;
  attachClient(url);
  return url;
}
