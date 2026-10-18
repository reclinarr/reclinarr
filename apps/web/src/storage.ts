const storage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} = {
  getItem: (key) => (typeof localStorage === "undefined" ? null : localStorage.getItem(key)),
  setItem: (key, value) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  },
};

export const webStorage = storage;

/** Expo web / Vite-style ports that are the SPA, not the Reclinarr API. */
export function isSpaDevPort(port: string): boolean {
  return port === "5173" || port === "8081" || port === "19006";
}

/**
 * API origin for the web client.
 * - Expo/Metro SPA on :5173 → same-origin `/api` is proxied to :8787 (empty base).
 * - Served from the API itself → empty base (same origin).
 * - EXPO_PUBLIC_API_URL overrides when set.
 */
export function apiBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const fromEnv = (globalThis as { process?: { env?: Record<string, string> } }).process?.env
    ?.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // Dev SPA: prefer relative URLs so Metro can proxy /api → API (cookies + no CORS).
  if (isSpaDevPort(window.location.port)) {
    return "";
  }
  return "";
}

/** True when `url` is this browser tab’s origin (Expo web, not the API). */
export function isCurrentSpaOrigin(url: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URL(url).origin === window.location.origin && isSpaDevPort(window.location.port);
  } catch {
    return false;
  }
}
