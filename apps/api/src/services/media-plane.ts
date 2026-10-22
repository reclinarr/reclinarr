import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";

/** True when nginx sits in front and should send media bytes via X-Accel-Redirect. */
export function mediaPlaneIsNginx(config: AppConfig): boolean {
  return config.RECLINARR_MEDIA_PLANE === "nginx";
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
