import AsyncStorage from "@react-native-async-storage/async-storage";
import appConfig from "../app.json";
import type { ReclinarrClient } from "@reclinarr/client";
import {
  attachClient as attach,
  clearSession as clear,
  loadServerUrl as load,
  probeServer,
  saveServerUrl as save,
  SESSION_KEY,
} from "@reclinarr/native-ui";
import { TvInput } from "../modules/tv-input";

export { SERVER_URL_KEY, SESSION_KEY, probeServer } from "@reclinarr/native-ui";

export async function loadServerUrl(): Promise<string | null> {
  return load(AsyncStorage);
}

export async function saveServerUrl(url: string): Promise<string> {
  return save(AsyncStorage, url);
}

export async function clearSession(): Promise<void> {
  await TvInput.clearCredentials();
  return clear(AsyncStorage);
}

/** Hands the signed-in session to the system TV guide integration and refreshes its channels. */
export async function syncTvInput(): Promise<void> {
  const [url, sessionId] = await Promise.all([loadServerUrl(), AsyncStorage.getItem(SESSION_KEY)]);
  if (!url || !sessionId) return;
  TvInput.setCredentials(url, sessionId);
  TvInput.requestSync();
}

export function attachClient(baseUrl: string): ReclinarrClient {
  return attach(AsyncStorage, baseUrl, appConfig.expo.version);
}
