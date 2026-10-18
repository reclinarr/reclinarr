import { z } from "zod";

export const LiveChannelGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type LiveChannelGroup = z.infer<typeof LiveChannelGroupSchema>;

export const LiveChannelSchema = z.object({
  id: z.string(),
  uuid: z.string(),
  name: z.string(),
  number: z.number().optional(),
  logoUrl: z.string().optional(),
  groupId: z.string().optional(),
  groupName: z.string().optional(),
  tvgId: z.string().optional(),
  favourite: z.boolean().optional(),
});
export type LiveChannel = z.infer<typeof LiveChannelSchema>;

export const EpgProgrammeSchema = z.object({
  id: z.string().optional(),
  channelId: z.string(),
  channelUuid: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  isLive: z.boolean().optional(),
});
export type EpgProgramme = z.infer<typeof EpgProgrammeSchema>;

export const LiveNowNextSchema = z.object({
  channelUuid: z.string(),
  now: EpgProgrammeSchema.nullable().optional(),
  next: EpgProgrammeSchema.nullable().optional(),
});
export type LiveNowNext = z.infer<typeof LiveNowNextSchema>;
