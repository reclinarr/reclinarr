import { join } from "node:path";
import type { MediaIdentity } from "@reclinarr/shared";

export interface LibraryNamingMeta {
  title: string;
  year?: number;
  seriesTitle?: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

/** Strip characters that break filesystem / Jellyfin folder scanners. */
export function sanitizeLibraryName(raw: string, fallback = "Unknown"): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/**
 * Jellyfin-friendly relative path under RECLINARR_DATA_DIR.
 * Movies: library/movies/{Title} ({Year})/{Title} ({Year}).mkv
 * Episodes: library/series/{Show}/Season NN/{Show} - SxxExx - {Ep}.mkv
 */
export function buildLibraryRelativePath(
  identity: MediaIdentity,
  meta?: LibraryNamingMeta | null,
): string {
  if (identity.mediaType === "episode") {
    const show = sanitizeLibraryName(
      meta?.seriesTitle || meta?.title || `TMDb ${identity.tmdbId ?? "unknown"}`,
    );
    const season = identity.seasonNumber ?? meta?.seasonNumber ?? 0;
    const ep = identity.episodeNumber ?? meta?.episodeNumber ?? 0;
    const seasonDir = `Season ${String(season).padStart(2, "0")}`;
    const epCode = `S${String(season).padStart(2, "0")}E${String(ep).padStart(2, "0")}`;
    const epTitle = meta?.episodeTitle ? ` - ${sanitizeLibraryName(meta.episodeTitle)}` : "";
    const file = `${show} - ${epCode}${epTitle}.mkv`;
    return join("library", "series", show, seasonDir, file);
  }

  const title = sanitizeLibraryName(meta?.title || `TMDb ${identity.tmdbId ?? "unknown"}`);
  const year = meta?.year;
  const folder = year ? `${title} (${year})` : title;
  const root = identity.mediaType === "tv" ? "series" : "movies";
  if (identity.mediaType === "tv") {
    return join("library", root, folder, `${folder}.mkv`);
  }
  return join("library", root, folder, `${folder}.mkv`);
}
