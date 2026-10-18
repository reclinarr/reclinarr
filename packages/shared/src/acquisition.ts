import { z } from "zod";
import { MediaIdentitySchema } from "./identity.js";

export const AcquisitionModeSchema = z.enum(["cache", "library"]);
export type AcquisitionMode = z.infer<typeof AcquisitionModeSchema>;

export const AcquisitionStateSchema = z.enum([
  "queued",
  "downloading",
  "playable",
  "completed",
  "failed",
  "cancelled",
]);
export type AcquisitionState = z.infer<typeof AcquisitionStateSchema>;

export const AcquisitionSourceSchema = z.object({
  provider: z.literal("dispatcharr"),
  movieId: z.number().optional(),
  episodeId: z.number().optional(),
  uuid: z.string(),
  streamId: z.string().optional(),
  m3uAccountId: z.number().optional(),
});
export type AcquisitionSource = z.infer<typeof AcquisitionSourceSchema>;

export const AcquisitionSchema = z.object({
  id: z.string(),
  identity: MediaIdentitySchema,
  mode: AcquisitionModeSchema,
  state: AcquisitionStateSchema,
  bytesDownloaded: z.number(),
  totalBytes: z.number().optional(),
  localPath: z.string().optional(),
  playbackAvailable: z.boolean(),
  source: AcquisitionSourceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Present for CACHE-mode jobs — when TTL eviction may delete the file. */
  cacheExpiresAt: z.string().optional(),
});
export type Acquisition = z.infer<typeof AcquisitionSchema>;

/** HTTP download engine used by AcquisitionManager. */
export interface DownloadTransport {
  start(opts: {
    url: string;
    headers?: Record<string, string>;
    destPath: string;
    /** Existing bytes on disk — sends Range and appends. */
    resumeFromBytes?: number;
    onProgress?: (bytes: number, total?: number) => void;
    signal?: AbortSignal;
  }): Promise<void>;

  /** Pipe an already-opened upstream Response (e.g. Dispatcharr proxy). */
  pipeResponse(opts: {
    response: Response;
    destPath: string;
    resumeFromBytes?: number;
    onProgress?: (bytes: number, total?: number) => void;
    signal?: AbortSignal;
  }): Promise<void>;
}
