import { z } from "zod";

export const ProviderCapabilitiesSchema = z.object({
  library: z.boolean(),
  playback: z.boolean(),
  progress: z.boolean(),
  transcoding: z.boolean(),
  discovery: z.boolean(),
  request: z.boolean(),
  vod: z.boolean(),
  liveTv: z.boolean(),
  epg: z.boolean(),
  acquisitionSource: z.boolean(),
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const ProviderHealthStatusSchema = z.enum(["ok", "degraded", "down", "unconfigured"]);
export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatusSchema>;

export const ProviderHealthSchema = z.object({
  id: z.string(),
  status: ProviderHealthStatusSchema,
  latencyMs: z.number().optional(),
  message: z.string().optional(),
  capabilities: ProviderCapabilitiesSchema,
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;
