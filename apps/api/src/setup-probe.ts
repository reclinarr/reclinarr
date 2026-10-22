import { ProviderError } from "@reclinarr/shared";
import {
  BazarrProvider,
  DispatcharrProvider,
  HttpClient,
  JellyfinProvider,
  SeerrProvider,
  type DispatcharrAuth,
} from "@reclinarr/providers";

export type SetupProbeService = "jellyfin" | "seerr" | "dispatcharr" | "bazarr";

export type SetupProbeInput = {
  service: SetupProbeService;
  JELLYFIN_URL?: string;
  SEERR_URL?: string;
  SEERR_API_KEY?: string;
  DISPATCHARR_URL?: string;
  DISPATCHARR_API_KEY?: string;
  DISPATCHARR_USERNAME?: string;
  DISPATCHARR_PASSWORD?: string;
  BAZARR_URL?: string;
  BAZARR_API_KEY?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type SetupProbeResult = { ok: boolean; message: string };

const DEFAULT_TIMEOUT_MS = 8_000;

/** Check one service with the addresses entered in the setup wizard. */
export async function probeSetupService(input: SetupProbeInput): Promise<SetupProbeResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl;
  try {
    switch (input.service) {
      case "jellyfin":
        return await probeJellyfin(requireHttpUrl(input.JELLYFIN_URL, "Jellyfin"), timeoutMs, fetchImpl);
      case "seerr":
        return await probeSeerr(
          requireHttpUrl(input.SEERR_URL, "Seerr"),
          input.SEERR_API_KEY?.trim() ?? "",
          timeoutMs,
          fetchImpl,
        );
      case "dispatcharr":
        return await probeDispatcharr(input, timeoutMs, fetchImpl);
      case "bazarr":
        return await probeBazarr(
          requireHttpUrl(input.BAZARR_URL, "Bazarr"),
          input.BAZARR_API_KEY?.trim() ?? "",
          timeoutMs,
          fetchImpl,
        );
    }
  } catch (err) {
    if (err instanceof ProbeInputError) return { ok: false, message: err.message };
    return { ok: false, message: err instanceof Error ? err.message : "Could not test this connection." };
  }
}

async function probeJellyfin(
  url: string,
  timeoutMs: number,
  fetchImpl?: typeof fetch,
): Promise<SetupProbeResult> {
  const health = await new JellyfinProvider({ baseUrl: url, timeoutMs, fetchImpl }).health();
  if (health.status !== "ok") return { ok: false, message: failureMessage("Jellyfin", health.message) };
  return { ok: true, message: health.message ? `Connected to ${health.message}.` : "Connected to Jellyfin." };
}

async function probeSeerr(
  url: string,
  apiKey: string,
  timeoutMs: number,
  fetchImpl?: typeof fetch,
): Promise<SetupProbeResult> {
  const health = await new SeerrProvider({ baseUrl: url, apiKey: apiKey || undefined, timeoutMs, fetchImpl }).health();
  if (health.status !== "ok") return { ok: false, message: failureMessage("Seerr", health.message) };
  if (!apiKey) return { ok: true, message: "Seerr is reachable. Add an API key so discovery and requests work." };
  try {
    await new HttpClient({
      baseUrl: url,
      timeoutMs,
      serviceName: "seerr",
      fetchImpl,
      defaultHeaders: { "X-Api-Key": apiKey },
    }).request("GET", "/api/v1/request", { query: { take: 1, skip: 0 } });
    return { ok: true, message: "Connected to Seerr." };
  } catch (err) {
    if (err instanceof ProviderError && (err.statusCode === 401 || err.statusCode === 403)) {
      return { ok: false, message: "Seerr rejected the API key." };
    }
    return { ok: false, message: err instanceof Error ? err.message : "Could not check the Seerr API key." };
  }
}

async function probeDispatcharr(
  input: SetupProbeInput,
  timeoutMs: number,
  fetchImpl?: typeof fetch,
): Promise<SetupProbeResult> {
  const url = requireHttpUrl(input.DISPATCHARR_URL, "Dispatcharr");
  const apiKey = input.DISPATCHARR_API_KEY?.trim() ?? "";
  const username = input.DISPATCHARR_USERNAME?.trim() ?? "";
  const password = input.DISPATCHARR_PASSWORD ?? "";
  let auth: DispatcharrAuth | undefined;
  if (apiKey) auth = { type: "apiKey", apiKey };
  else if (username && password) auth = { type: "credentials", username, password };
  else return { ok: false, message: "Add an API key, or a username and password." };

  const health = await new DispatcharrProvider({ baseUrl: url, auth, timeoutMs, fetchImpl }).health();
  if (health.status !== "ok") return { ok: false, message: failureMessage("Dispatcharr", health.message) };
  return { ok: true, message: "Connected to Dispatcharr." };
}

async function probeBazarr(
  url: string,
  apiKey: string,
  timeoutMs: number,
  fetchImpl?: typeof fetch,
): Promise<SetupProbeResult> {
  if (!apiKey) return { ok: false, message: "Enter the Bazarr API key." };
  const health = await new BazarrProvider({ baseUrl: url, apiKey, timeoutMs, fetchImpl }).health();
  if (health.status !== "ok") return { ok: false, message: failureMessage("Bazarr", health.message) };
  return {
    ok: true,
    message: health.message ? `Connected to Bazarr ${health.message}.` : "Connected to Bazarr.",
  };
}

function failureMessage(service: string, message: string | undefined): string {
  if (!message || /fetch failed|timeout|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network/i.test(message)) {
    return `Could not reach ${service}. Check the address and that the server is running.`;
  }
  return message;
}

class ProbeInputError extends Error {}

function requireHttpUrl(value: string | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new ProbeInputError(`Enter the ${label} address.`);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ProbeInputError(`${label} address must start with http:// or https://.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProbeInputError(`${label} address must start with http:// or https://.`);
  }
  return trimmed.replace(/\/+$/, "");
}
