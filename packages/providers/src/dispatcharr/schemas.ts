import { z } from "zod";

const LogoSchema = z
  .object({
    id: z.number().optional(),
    name: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
    cache_url: z.string().optional().nullable(),
  })
  .passthrough()
  .nullable()
  .optional();

export const DispatcharrMovieSchema = z
  .object({
    id: z.number(),
    uuid: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    year: z.number().nullable().optional(),
    tmdb_id: z.union([z.string(), z.number()]).nullable().optional(),
    imdb_id: z.string().nullable().optional(),
    duration_secs: z.number().nullable().optional(),
    logo: LogoSchema,
  })
  .passthrough();

export const DispatcharrSeriesSchema = z
  .object({
    id: z.number(),
    uuid: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    year: z.number().nullable().optional(),
    tmdb_id: z.union([z.string(), z.number()]).nullable().optional(),
    imdb_id: z.string().nullable().optional(),
    logo: LogoSchema,
    episode_count: z.number().optional(),
  })
  .passthrough();

export const DispatcharrEpisodeSchema = z
  .object({
    id: z.number(),
    uuid: z.string(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    duration_secs: z.number().nullable().optional(),
    season_number: z.number().nullable().optional(),
    episode_number: z.number().nullable().optional(),
    tmdb_id: z.union([z.string(), z.number()]).nullable().optional(),
    series: z
      .object({
        id: z.number().optional(),
        name: z.string().optional(),
        tmdb_id: z.union([z.string(), z.number()]).nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const DispatcharrPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      count: z.number().optional(),
      next: z.string().nullable().optional(),
      previous: z.string().nullable().optional(),
      results: z.array(item).optional(),
    })
    .passthrough();

export const DispatcharrMovieProviderSchema = z
  .object({
    id: z.number().optional(),
    stream_id: z.string().optional().nullable(),
    quality_info: z
      .object({
        quality: z.string().optional(),
        resolution: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    m3u_account: z
      .object({
        id: z.number().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    /** Language / pack bucket — primary signal for stream ranking (e.g. "EN - DRAMA"). */
    category: z
      .object({
        id: z.number().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    custom_properties: z
      .object({
        basic_data: z
          .object({
            name: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    /** Nested movie payload often carries duration when the list endpoint does not. */
    movie: z
      .object({
        duration_secs: z.number().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const DispatcharrMovieProviderInfoSchema = z
  .object({
    id: z.number(),
    uuid: z.string(),
    stream_id: z.string(),
    name: z.string().optional(),
    tmdb_id: z.union([z.string(), z.number()]).nullable().optional(),
    duration_secs: z.number().nullable().optional(),
  })
  .passthrough();

export const DispatcharrChannelGroupSchema = z
  .object({
    id: z.number(),
    name: z.string(),
  })
  .passthrough();

export const DispatcharrChannelSchema = z
  .object({
    id: z.number(),
    uuid: z.string(),
    name: z.string(),
    channel_number: z.union([z.number(), z.string()]).nullable().optional(),
    channel_group_id: z.number().nullable().optional(),
    tvg_id: z.string().nullable().optional(),
    logo_id: z.number().nullable().optional(),
    epg_data_id: z.number().nullable().optional(),
    effective_name: z.string().nullable().optional(),
    effective_channel_number: z.union([z.number(), z.string()]).nullable().optional(),
    effective_channel_group_id: z.number().nullable().optional(),
    effective_logo_id: z.number().nullable().optional(),
    effective_tvg_id: z.string().nullable().optional(),
    effective_epg_data_id: z.number().nullable().optional(),
    hidden_from_output: z.boolean().optional(),
  })
  .passthrough();

export const DispatcharrProgramSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    start_time: z.string(),
    end_time: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    tvg_id: z.string().nullable().optional(),
    channel_uuid: z.string().nullable().optional(),
    epg_data_id: z.number().nullable().optional(),
    is_live: z.boolean().optional(),
  })
  .passthrough();

export const DispatcharrSeriesProviderInfoSchema = z
  .object({
    id: z.number().optional(),
    episodes: z.record(z.string(), z.array(z.unknown())).optional(),
  })
  .passthrough();
export type DispatcharrMovie = z.infer<typeof DispatcharrMovieSchema>;
export type DispatcharrSeries = z.infer<typeof DispatcharrSeriesSchema>;
export type DispatcharrEpisode = z.infer<typeof DispatcharrEpisodeSchema>;
export type DispatcharrChannel = z.infer<typeof DispatcharrChannelSchema>;
export type DispatcharrChannelGroup = z.infer<typeof DispatcharrChannelGroupSchema>;
export type DispatcharrProgram = z.infer<typeof DispatcharrProgramSchema>;
