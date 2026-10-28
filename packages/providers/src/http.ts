import type { ZodType } from "zod";
import { ProviderError, classifyHttpStatus, redactSecrets } from "@reclinarr/shared";

export type FetchLike = typeof fetch;

const MAX_REDIRECTS = 5;
/** Headers that carry no credential and still make sense on another host. */
const PORTABLE_HEADERS = ["accept", "range", "if-range", "user-agent"];

/**
 * fetch() follows redirects to other hosts with every custom header intact (it only drops
 * Authorization and cookies), so API keys and Cloudflare Access secrets would reach whatever
 * host an upstream redirects to. Follow redirects here instead, and send only portable headers
 * once the request leaves the original origin.
 */
export async function fetchFollowingRedirects(
  fetchImpl: FetchLike,
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  let url = new URL(String(input));
  const origin = url.origin;
  let headers = new Headers(init.headers);
  let method = init.method ?? "GET";
  let body = init.body;
  for (let hop = 0; ; hop++) {
    const res = await fetchImpl(url, { ...init, method, body, headers, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    if (hop === MAX_REDIRECTS) throw new Error(`Too many redirects from ${origin}`);
    await res.body?.cancel();
    url = new URL(location, url);
    if (url.origin !== origin) {
      const portable = new Headers();
      for (const name of PORTABLE_HEADERS) {
        const value = headers.get(name);
        if (value !== null) portable.set(name, value);
      }
      headers = portable;
    }
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
      headers.delete("content-type");
    }
  }
}

export type ProviderOperationMetric = {
  service: string;
  durationMs: number;
  outcome: "success" | "failure";
  status?: number;
};

let providerMetricsObserver: ((metric: ProviderOperationMetric) => void) | undefined;

/** Install a best-effort observer; callers should keep the callback non-blocking. */
export function setProviderMetricsObserver(
  observer: ((metric: ProviderOperationMetric) => void) | undefined,
): void {
  providerMetricsObserver = observer;
}

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  defaultHeaders?: Record<string, string>;
  fetchImpl?: FetchLike;
  serviceName: string;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchImpl: FetchLike;
  private readonly serviceName: string;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs;
    this.defaultHeaders = opts.defaultHeaders ?? {};
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.serviceName = opts.serviceName;
  }

  withHeaders(headers: Record<string, string>): HttpClient {
    return new HttpClient({
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      defaultHeaders: { ...this.defaultHeaders, ...headers },
      fetchImpl: this.fetchImpl,
      serviceName: this.serviceName,
    });
  }

  async request<T>(
    method: string,
    path: string,
    opts?: {
      query?: Record<string, string | number | boolean | undefined | null>;
      body?: unknown;
      headers?: Record<string, string>;
      schema?: ZodType<T>;
      allowStatuses?: number[];
      rawBody?: boolean;
      timeoutMs?: number;
    },
  ): Promise<{ status: number; data: T; headers: Headers }> {
    const timeoutMs = opts?.timeoutMs ?? this.timeoutMs;
    const url = new URL(this.baseUrl + (path.startsWith("/") ? path : `/${path}`));
    if (opts?.query) {
      // Use encodeURIComponent (%20) — not URLSearchParams (+).
      // Seerr's OpenAPI validator rejects `+` as "not url encoded".
      const parts: string[] = [];
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === null || v === "") continue;
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
      if (parts.length > 0) url.search = parts.join("&");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    let outcome: "success" | "failure" = "failure";
    let status: number | undefined;
    try {
      const res = await fetchFollowingRedirects(this.fetchImpl, url, {
        method,
        headers: {
          Accept: "application/json",
          ...this.defaultHeaders,
          ...(opts?.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...opts?.headers,
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      status = res.status;

      const text = await res.text();
      let json: unknown = undefined;
      if (text) {
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          json = text;
        }
      }

      const allowed = opts?.allowStatuses ?? [];
      if (!res.ok && !allowed.includes(res.status)) {
        throw new ProviderError(`${this.serviceName} HTTP ${res.status} ${method} ${path}`, {
          code: classifyHttpStatus(res.status),
          provider: this.serviceName,
          statusCode: res.status,
          details: redactSecrets(json),
        });
      }

      let data = json as T;
      if (opts?.schema) {
        const parsed = opts.schema.safeParse(json);
        if (!parsed.success) {
          throw new ProviderError(
            `${this.serviceName} response schema mismatch for ${method} ${path}`,
            {
              code: "schema_mismatch",
              provider: this.serviceName,
              statusCode: res.status,
              details: {
                issues: parsed.error.issues,
                body: redactSecrets(json),
              },
            },
          );
        }
        data = parsed.data;
      }

      outcome = res.ok || allowed.includes(res.status) ? "success" : "failure";
      return { status: res.status, data, headers: res.headers };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ProviderError(`${this.serviceName} timeout after ${timeoutMs}ms`, {
          code: "timeout",
          provider: this.serviceName,
          cause: err,
        });
      }
      throw new ProviderError(`${this.serviceName} request failed: ${String(err)}`, {
        code: "unavailable",
        provider: this.serviceName,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
      try {
        const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
        providerMetricsObserver?.({
          service: this.serviceName,
          durationMs: Math.max(0, ended - started),
          outcome,
          status,
        });
      } catch {
        // Observability must never affect provider requests.
      }
    }
  }
}

export function mediaBrowserAuth(opts: {
  client: string;
  device: string;
  deviceId: string;
  version: string;
  token?: string;
}): string {
  const parts = [
    `Client="${opts.client}"`,
    `Device="${opts.device}"`,
    `DeviceId="${opts.deviceId}"`,
    `Version="${opts.version}"`,
  ];
  if (opts.token) parts.push(`Token="${opts.token}"`);
  return `MediaBrowser ${parts.join(", ")}`;
}
