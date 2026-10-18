import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export function hlsDir(dataDir: string, acquisitionId: string): string {
  return join(dataDir, "hls", acquisitionId);
}

export function hlsPlaylistPath(dataDir: string, acquisitionId: string): string {
  return join(hlsDir(dataDir, acquisitionId), "index.m3u8");
}

/** True when the packager has published at least one media segment. */
export function hlsPlaybackReady(dataDir: string, acquisitionId: string): boolean {
  const playlist = hlsPlaylistPath(dataDir, acquisitionId);
  if (!existsSync(playlist)) return false;
  try {
    const text = readFileSync(playlist, "utf8");
    return /#EXTINF:/m.test(text);
  } catch {
    return false;
  }
}

export function hlsFinalized(dataDir: string, acquisitionId: string): boolean {
  const playlist = hlsPlaylistPath(dataDir, acquisitionId);
  if (!existsSync(playlist)) return false;
  try {
    return readFileSync(playlist, "utf8").includes("#EXT-X-ENDLIST");
  } catch {
    return false;
  }
}

/** Remove HLS output for an acquisition (TTL eviction / promote). */
export function removeHlsDir(dataDir: string, acquisitionId: string): void {
  const dir = hlsDir(dataDir, acquisitionId);
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function listHlsSegmentNames(dataDir: string, acquisitionId: string): string[] {
  const dir = hlsDir(dataDir, acquisitionId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".ts") || n.endsWith(".m4s"));
}
