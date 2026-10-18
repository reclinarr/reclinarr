import { z } from "zod";

export const JellyfinUserSchema = z
  .object({
    Id: z.string(),
    Name: z.string(),
  })
  .passthrough();

export const JellyfinAuthResultSchema = z
  .object({
    User: JellyfinUserSchema,
    AccessToken: z.string(),
    SessionInfo: z
      .object({
        Id: z.string().optional(),
        DeviceId: z.string().optional(),
      })
      .passthrough()
      .optional(),
    ServerId: z.string().optional(),
  })
  .passthrough();

export const JellyfinUserDataSchema = z
  .object({
    PlaybackPositionTicks: z.number().optional(),
    PlayedPercentage: z.number().optional(),
    Played: z.boolean().optional(),
  })
  .passthrough()
  .optional();

export const JellyfinItemSchema = z
  .object({
    Id: z.string(),
    Name: z.string().optional(),
    Type: z.string().optional(),
    Overview: z.string().optional().nullable(),
    ProductionYear: z.number().optional().nullable(),
    RunTimeTicks: z.number().optional().nullable(),
    Path: z.string().optional().nullable(),
    SeriesName: z.string().optional().nullable(),
    ParentIndexNumber: z.number().optional().nullable(),
    IndexNumber: z.number().optional().nullable(),
    SeriesId: z.string().optional().nullable(),
    ProviderIds: z.record(z.string().nullable()).optional().nullable(),
    MediaSources: z
      .array(
        z
          .object({
            Id: z.string().optional(),
            Path: z.string().optional().nullable(),
            Container: z.string().optional().nullable(),
            SupportsDirectPlay: z.boolean().optional(),
            SupportsDirectStream: z.boolean().optional(),
            SupportsTranscoding: z.boolean().optional(),
            TranscodingUrl: z.string().optional().nullable(),
          })
          .passthrough(),
      )
      .optional()
      .nullable(),
    ImageTags: z.record(z.string()).optional().nullable(),
    BackdropImageTags: z.array(z.string()).optional().nullable(),
    UserData: JellyfinUserDataSchema,
  })
  .passthrough();

export type JellyfinItem = z.infer<typeof JellyfinItemSchema>;

export const JellyfinItemsResponseSchema = z
  .object({
    Items: z.array(JellyfinItemSchema).default([]),
    TotalRecordCount: z.number().optional(),
  })
  .passthrough();

export const JellyfinSystemInfoSchema = z
  .object({
    ServerName: z.string().optional(),
    Version: z.string().optional(),
    Id: z.string().optional(),
  })
  .passthrough();

export const JellyfinPlaybackInfoSchema = z
  .object({
    MediaSources: z
      .array(
        z
          .object({
            Id: z.string(),
            Container: z.string().optional().nullable(),
            SupportsDirectPlay: z.boolean().optional(),
            SupportsDirectStream: z.boolean().optional(),
            SupportsTranscoding: z.boolean().optional(),
            TranscodingUrl: z.string().optional().nullable(),
            TranscodingSubProtocol: z.string().optional().nullable(),
            TranscodingContainer: z.string().optional().nullable(),
            DefaultAudioStreamIndex: z.number().optional().nullable(),
            MediaStreams: z
              .array(
                z
                  .object({
                    Type: z.string().optional(),
                    Codec: z.string().optional().nullable(),
                    Index: z.number().optional(),
                    IsDefault: z.boolean().optional(),
                    IsExternal: z.boolean().optional(),
                    IsTextSubtitleStream: z.boolean().optional(),
                    IsForced: z.boolean().optional(),
                    IsHearingImpaired: z.boolean().optional(),
                    Language: z.string().optional().nullable(),
                    DisplayTitle: z.string().optional().nullable(),
                  })
                  .passthrough(),
              )
              .optional()
              .nullable(),
          })
          .passthrough(),
      )
      .default([]),
    PlaySessionId: z.string().optional(),
  })
  .passthrough();
