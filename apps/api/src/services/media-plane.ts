import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";

/** True when nginx sits in front and should send media bytes via X-Accel-Redirect. */
export function mediaPlaneIsNginx(config: AppConfig): boolean {
  return config.RECLINARR_MEDIA_PLANE === "nginx";
}

/**
 * nginx renders its upstream addresses once at container start, but an admin edit reloads the
 * API with a new one. Hand a provider's media to nginx only while the two still agree; otherwise
 * the API streams it itself (nginx would send the new server's token to the old host).
 * Without the entrypoint's variables (a hand-written nginx in front) the plane setting decides.
 */
export function nginxServesProvider(
  config: AppConfig,
  provider: "jellyfin" | "dispatcharr",
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!mediaPlaneIsNginx(config)) return false;
  const rendered =
    provider === "jellyfin" ? env.RECLINARR_NGINX_JELLYFIN_UPSTREAM : env.RECLINARR_NGINX_DISPATCHARR_UPSTREAM;
  if (!rendered) return true;
  const configured = provider === "jellyfin" ? config.JELLYFIN_URL : config.DISPATCHARR_URL;
  try {
    return new URL(configured).origin === new URL(rendered).origin;
  } catch {
    return false;
  }
}

/**
 * Hand the body off to nginx. The browser never sees this path.
 * `accelPath` must start with an internal location prefix (/_upstream/... or /_hls/...).
 */
export function sendAccelRedirect(
  reply: FastifyReply,
  accelPath: string,
  opts?: { contentType?: string; buffering?: boolean },
): FastifyReply {
  reply.header("X-Accel-Redirect", accelPath);
  if (opts?.buffering === false) {
    reply.header("X-Accel-Buffering", "no");
  }
  if (opts?.contentType) {
    reply.header("Content-Type", opts.contentType);
  }
  reply.header("Cache-Control", "no-store");
  return reply.status(204).send();
}

/** Map a full upstream URL onto nginx's internal `/_upstream/{provider}/...` location. */
export function upstreamAccelPath(
  provider: "jellyfin" | "dispatcharr",
  absoluteUrl: string,
): string {
  const u = new URL(absoluteUrl);
  return `/_upstream/${provider}${u.pathname}${u.search}`;
}

/** Internal alias path for HLS files under `$DATA/hls/{acquisitionId}/...`. */
export function hlsAccelPath(acquisitionId: string, relativePath: string): string {
  const clean = relativePath
    .replace(/\.\./g, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  // Acquisition ids are UUIDs (filesystem-safe); keep them unescaped for alias mapping.
  return `/_hls/${acquisitionId}/${clean}`;
}

/** True when the request came through our nginx (extra safety for internal-only routes). */
export function requestFromMediaPlane(req: FastifyRequest): boolean {
  return req.headers["x-reclinarr-media-plane"] === "nginx";
}

const RASTER_IMAGE = /^image\/(jpeg|png|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/;
const MEDIA =
  /^(video\/[\w.+-]+|audio\/[\w.+-]+|application\/(vnd\.apple\.mpegurl|x-mpegurl|mp4|octet-stream)|text\/vtt)$/;

/**
 * Upstream bytes are served from the app's own origin, so an upstream-chosen type such as
 * text/html or image/svg+xml would run script with the user's session. Keep known image or
 * media types; anything else becomes an opaque download.
 */
export function safeProxiedContentType(contentType: string | null, kind: "image" | "media"): string {
  const ct = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (RASTER_IMAGE.test(ct)) return contentType!;
  if (kind === "media" && MEDIA.test(ct)) return contentType!;
  return "application/octet-stream";
}

/** Proxied upstream content never gets to run as a page on our origin. */
export function sandboxProxiedContent(reply: FastifyReply): FastifyReply {
  return reply.header("Content-Security-Policy", "sandbox; default-src 'none'");
}
