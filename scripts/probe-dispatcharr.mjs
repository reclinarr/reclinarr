/**
 * Quick Phase 4 probe: Seerr title → Dispatcharr match → stream bytes.
 * Usage: node scripts/probe-dispatcharr.mjs [tmdbId]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DispatcharrProvider, SeerrProvider } from "@reclinarr/providers";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env") });

const tmdbId = Number(process.argv[2] || 550);
const mediaType = "movie";

const seerr = new SeerrProvider({
  baseUrl: process.env.SEERR_URL || "",
  apiKey: process.env.SEERR_API_KEY,
});
const dispatcharr = new DispatcharrProvider({
  baseUrl: process.env.DISPATCHARR_URL || "",
  auth: process.env.DISPATCHARR_API_KEY
    ? { type: "apiKey", apiKey: process.env.DISPATCHARR_API_KEY }
    : undefined,
  reclinarrPublicUrl: process.env.RECLINARR_PUBLIC_URL,
});

const details = await seerr.getDetails(mediaType, tmdbId);
const titleHint = details?.metadata.title;
console.log("seerr", titleHint || "(none)", "action", details?.preferredAction);

const vod = await dispatcharr.findVodByTmdb(tmdbId, mediaType, { titleHint });
if (!vod) {
  console.error("no dispatcharr match");
  process.exit(1);
}
const da = vod.availability.find((a) => a.provider === "dispatcharr");
console.log("vod", vod.metadata.title, "uuid", da?.uuid, "candidates", da?.candidates?.length);
console.log("preferred", vod.preferredAction);

const source = await dispatcharr.resolveVodPlayback({ tmdbId, mediaType });
console.log("playback", source?.delivery);

if (!da?.uuid) process.exit(1);
const path = `/proxy/vod/movie/${da.uuid}`;
const url = new URL((process.env.DISPATCHARR_URL || "").replace(/\/+$/, "") + path);
if (da.candidates?.[0]?.streamId) url.searchParams.set("stream_id", da.candidates[0].streamId);
const res = await fetch(url, {
  headers: {
    Authorization: `ApiKey ${process.env.DISPATCHARR_API_KEY}`,
    Range: "bytes=0-65535",
  },
  redirect: "follow",
});
const buf = Buffer.from(await res.arrayBuffer());
console.log(
  "stream",
  res.status,
  res.headers.get("content-type"),
  "bytes",
  buf.length,
  "magic",
  buf.slice(0, 4).toString("hex"),
);
