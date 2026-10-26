import { z } from "zod";
import type { DispatcharrAuth } from "@reclinarr/providers";
import { parsePreferredLanguages } from "@reclinarr/shared";

const EnvSchema = z.object({
  RECLINARR_PORT: z.coerce.number().default(8787),
  RECLINARR_DATA_DIR: z.string().default("./data"),
  RECLINARR_PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  /**
   * Reverse proxies in front of Reclinarr (comma-separated IPs/CIDRs) whose X-Forwarded-For
   * is trusted for client IPs. Loopback (the bundled nginx) is always trusted.
   */
  RECLINARR_TRUSTED_PROXIES: z.string().default(""),
  RECLINARR_TELEMETRY_DISABLED: z.string().optional().transform((v) => v === "1" || v === "true"),
  /**
   * Jellyfin usernames (comma-separated, case-insensitive) that only see and play the
   * Jellyfin library: no Seerr discovery, requests, or IPTV downloads. For store review accounts.
   */
  RECLINARR_DEMO_USERS: z.string().default(""),
  /**
   * `nginx` — API returns X-Accel-Redirect; nginx sends media bytes.
   * `node` — API pipes upstream / local files (local Vite/dev default).
   */
  RECLINARR_MEDIA_PLANE: z.enum(["nginx", "node"]).default("node"),
  /**
   * When true (default), the API process runs the HLS packager loop.
   * Docker runs a dedicated packager process and sets this to false.
   */
  RECLINARR_EMBED_PACKAGER: z
    .string()
    .optional()
    .transform((v) => v !== "0" && v !== "false"),
  RECLINARR_USE_MOCKS: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  JELLYFIN_URL: z.string().default(""),
  SEERR_URL: z.string().default(""),
  SEERR_API_KEY: z.string().optional(),
  DISPATCHARR_URL: z.string().default(""),
  DISPATCHARR_API_KEY: z.string().optional(),
  DISPATCHARR_USERNAME: z.string().optional(),
  DISPATCHARR_PASSWORD: z.string().optional(),
  DISPATCHARR_CF_ACCESS_CLIENT_ID: z.string().optional(),
  DISPATCHARR_CF_ACCESS_CLIENT_SECRET: z.string().optional(),
  BAZARR_URL: z.string().default(""),
  BAZARR_API_KEY: z.string().optional(),
  HTTP_TIMEOUT_MS: z.coerce.number().default(15_000),
  /** Max bytes for CACHE-mode acquisitions (default 50 GiB). */
  RECLINARR_CACHE_MAX_BYTES: z.coerce.number().default(50 * 1024 * 1024 * 1024),
  /** Max time an idle CACHE file is kept (default 7 days). */
  RECLINARR_CACHE_TTL_MS: z.coerce.number().default(7 * 24 * 60 * 60 * 1000),
  /** CACHE files watched past 95% are deleted this long after viewing (default 24 hours). */
  RECLINARR_CACHE_WATCHED_TTL_MS: z.coerce.number().default(24 * 60 * 60 * 1000),
  /** Max concurrent IPTV upstream connections (live + VOD + downloads). */
  RECLINARR_IPTV_MAX_CONNECTIONS: z.coerce.number().int().positive().default(3),
  /**
   * Preferred IPTV catalogue/audio languages (comma-separated, strongest first).
   * Used to rank EN-/IT- prefixed Dispatcharr VOD variants for the same TMDb id.
   */
  RECLINARR_PREFERRED_LANGUAGES: z.string().default("en"),
  /** How often to rescan the Dispatcharr VOD catalogue into SQLite (default 12h). */
  RECLINARR_VOD_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(12 * 60 * 60 * 1000),
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
  /**
   * Live TV H.264 encoder. `auto` probes VideoToolbox, VAAPI, NVENC, and Quick Sync
   * and falls back to libx264. `off` forces the software encoder.
   */
  RECLINARR_HWACCEL: z
    .enum(["auto", "off", "nvenc", "qsv", "vaapi", "videotoolbox"])
    .default("auto"),
  /** VAAPI/QSV render node. Default is the first `/dev/dri/renderD*`. */
  RECLINARR_VAAPI_DEVICE: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

export type AppConfig = Omit<z.infer<typeof EnvSchema>, "RECLINARR_PREFERRED_LANGUAGES"> & {
  RECLINARR_PREFERRED_LANGUAGES: string[];
  dispatcharrAuth?: DispatcharrAuth;
  dispatcharrCloudflareAccess?: { clientId: string; clientSecret: string };
};

/**
 * Environment variables win over values saved by the setup wizard (`stored`), except an
 * empty `KEY=` (e.g. copied from .env.example), which counts as unset.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  stored: Record<string, string> = {},
): AppConfig {
  const merged: NodeJS.ProcessEnv = { ...stored };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== "") merged[key] = value;
  }
  const parsed = EnvSchema.parse(merged);
  let dispatcharrAuth: DispatcharrAuth | undefined;
  if (parsed.DISPATCHARR_API_KEY) {
    dispatcharrAuth = { type: "apiKey", apiKey: parsed.DISPATCHARR_API_KEY };
  } else if (parsed.DISPATCHARR_USERNAME && parsed.DISPATCHARR_PASSWORD) {
    dispatcharrAuth = {
      type: "credentials",
      username: parsed.DISPATCHARR_USERNAME,
      password: parsed.DISPATCHARR_PASSWORD,
    };
  }
  let dispatcharrCloudflareAccess: AppConfig["dispatcharrCloudflareAccess"];
  if (parsed.DISPATCHARR_CF_ACCESS_CLIENT_ID && parsed.DISPATCHARR_CF_ACCESS_CLIENT_SECRET) {
    dispatcharrCloudflareAccess = {
      clientId: parsed.DISPATCHARR_CF_ACCESS_CLIENT_ID,
      clientSecret: parsed.DISPATCHARR_CF_ACCESS_CLIENT_SECRET,
    };
  }
  return {
    ...parsed,
    RECLINARR_PREFERRED_LANGUAGES: parsePreferredLanguages(parsed.RECLINARR_PREFERRED_LANGUAGES),
    dispatcharrAuth,
    dispatcharrCloudflareAccess,
  };
}

/** Prefer Secure cookies when the public URL is https or NODE_ENV is production. */
export function sessionCookieSecure(config: AppConfig): boolean {
  if (config.NODE_ENV === "production") return true;
  return new URL(config.RECLINARR_PUBLIC_URL).protocol === "https:";
}
