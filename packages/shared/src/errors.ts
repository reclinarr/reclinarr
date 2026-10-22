export type ProviderErrorCode =
  | "timeout"
  | "unavailable"
  | "unauthorized"
  | "schema_mismatch"
  | "not_found"
  | "rate_limited"
  | "unknown";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly provider: string;
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(
    message: string,
    opts: {
      code: ProviderErrorCode;
      provider: string;
      statusCode?: number;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ProviderError";
    this.code = opts.code;
    this.provider = opts.provider;
    this.statusCode = opts.statusCode;
    this.details = opts.details;
  }
}

export function classifyHttpStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "unknown";
}

const SECRET_KEYS = /password|token|authorization|api[_-]?key|secret|credential/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redactSecrets(v);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 200) {
    return `${value.slice(0, 80)}…[truncated]`;
  }
  return value;
}

/** Shown when the IPTV provider / Dispatcharr rejects a stream for max connections. */
export const IPTV_STREAM_BUSY_MESSAGE =
  "Another IPTV stream is already open (for example on another TV). Close that one and try again.";

/** Detect Dispatcharr / XC "max connections" style failures. */
export function isIptvConnectionLimitError(
  statusOrMessage?: number | string | null,
  body?: string | null,
): boolean {
  const status = typeof statusOrMessage === "number" ? statusOrMessage : undefined;
  const text = [typeof statusOrMessage === "string" ? statusOrMessage : "", body ?? ""]
    .join(" ")
    .toLowerCase();
  if (
    text.includes("maximum connection") ||
    text.includes("max connection") ||
    text.includes("connection limit") ||
    text.includes("reached maximum") ||
    text.includes("active m3u profiles have reached") ||
    text.includes("iptv connection limit")
  ) {
    return true;
  }
  // Empty 502/503 on live proxy is almost always the provider slot being full
  // (nginx X-Accel hides the Dispatcharr JSON body from the player).
  if (status === 503) return true;
  if (status === 502 && (!body || !body.trim())) return true;
  return false;
}

/**
 * Map an upstream IPTV failure to a user-facing message, or null if unrelated.
 */
export function formatIptvUpstreamError(
  status: number,
  body?: string | null,
): string | null {
  if (!isIptvConnectionLimitError(status, body)) return null;
  return IPTV_STREAM_BUSY_MESSAGE;
}

/**
 * ExoPlayer ERROR_CODE_BEHIND_LIVE_WINDOW — playhead fell outside a sliding /
 * event HLS window. react-native-video recovers with seekToDefaultPosition +
 * prepare, but still emits onError; treat as non-fatal in app chrome.
 */
export function isBehindLiveWindowError(
  message?: string | null,
  code?: number | string | null,
): boolean {
  if (
    code === 1002 ||
    code === "1002" ||
    code === "21002" ||
    (typeof code === "string" && /BEHIND_LIVE_WINDOW/i.test(code))
  ) {
    return true;
  }
  return Boolean(message && /BEHIND_LIVE_WINDOW|behind\s*live\s*window/i.test(message));
}

/**
 * Live errors that should surface immediately instead of auto-reloading
 * (another device holding the IPTV slot, auth, missing channel).
 */
export function isNonRecoverableLiveError(message?: string | null): boolean {
  if (!message) return false;
  if (message === IPTV_STREAM_BUSY_MESSAGE) return true;
  if (isIptvConnectionLimitError(message)) return true;
  if (/another iptv stream is already open/i.test(message)) return true;
  if (/not signed in|session missing|unauthorized|forbidden/i.test(message)) return true;
  if (/channel (is )?not playable|channel not found|no longer selected/i.test(message)) {
    return true;
  }
  return false;
}

/**
 * Map opaque player IO failures (mpegts.js / hls.js) to a clearer IPTV message.
 */
export function formatPlaybackIoError(info: {
  code?: number | string | null;
  msg?: string | null;
  message?: string | null;
  type?: string | null;
}): string | null {
  const codeRaw = info.code;
  const code =
    typeof codeRaw === "number"
      ? codeRaw
      : typeof codeRaw === "string" && /^\d+$/.test(codeRaw)
        ? Number(codeRaw)
        : undefined;
  const msg = info.msg ?? info.message ?? "";
  if (isBehindLiveWindowError(msg, codeRaw)) return null;
  if (isIptvConnectionLimitError(code, msg) || isIptvConnectionLimitError(msg)) {
    return IPTV_STREAM_BUSY_MESSAGE;
  }
  // mpegts.js: "IOException: type = HttpStatusCodeInvalid, code = 502, msg ="
  if (
    /httpstatuscodeinvalid/i.test(msg) &&
    (/\b502\b/.test(msg) || /\b503\b/.test(msg) || code === 502 || code === 503)
  ) {
    return IPTV_STREAM_BUSY_MESSAGE;
  }
  if (
    (code === 502 || code === 503) &&
    (!msg.trim() || /loader error/i.test(msg))
  ) {
    return IPTV_STREAM_BUSY_MESSAGE;
  }
  return null;
}
