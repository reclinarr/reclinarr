import { z } from "zod";

export const SeerrMediaStatus = {
  UNKNOWN: 1,
  PENDING: 2,
  PROCESSING: 3,
  PARTIALLY_AVAILABLE: 4,
  AVAILABLE: 5,
  BLOCKLISTED: 6,
  DELETED: 7,
} as const;

export const SeerrRequestStatus = {
  PENDING: 1,
  APPROVED: 2,
  DECLINED: 3,
  FAILED: 4,
  COMPLETED: 5,
} as const;

export const MEDIA_STATUS_LABEL: Record<number, string> = {
  [SeerrMediaStatus.UNKNOWN]: "UNKNOWN",
  [SeerrMediaStatus.PENDING]: "PENDING",
  [SeerrMediaStatus.PROCESSING]: "PROCESSING",
  [SeerrMediaStatus.PARTIALLY_AVAILABLE]: "PARTIALLY_AVAILABLE",
  [SeerrMediaStatus.AVAILABLE]: "AVAILABLE",
  [SeerrMediaStatus.BLOCKLISTED]: "BLOCKLISTED",
  [SeerrMediaStatus.DELETED]: "DELETED",
};

export const REQUEST_STATUS_LABEL: Record<number, string> = {
  [SeerrRequestStatus.PENDING]: "PENDING",
  [SeerrRequestStatus.APPROVED]: "APPROVED",
  [SeerrRequestStatus.DECLINED]: "DECLINED",
  [SeerrRequestStatus.FAILED]: "FAILED",
  [SeerrRequestStatus.COMPLETED]: "COMPLETED",
};

const MediaInfoSchema = z
  .object({
    id: z.number().optional(),
    tmdbId: z.number().optional(),
    tvdbId: z.number().nullable().optional(),
    status: z.number().optional(),
    status4k: z.number().optional(),
    mediaType: z.string().optional(),
    requests: z
      .array(
        z
          .object({
            id: z.number().optional(),
            status: z.number().optional(),
          })
          .passthrough(),
      )
      .optional(),
    seasons: z
      .array(
        z
          .object({
            seasonNumber: z.number(),
            status: z.number().optional(),
            status4k: z.number().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export const SeerrSearchResultSchema = z
  .object({
    id: z.number(),
    mediaType: z.string(),
    title: z.string().optional(),
    name: z.string().optional(),
    originalTitle: z.string().optional(),
    originalName: z.string().optional(),
    overview: z.string().optional().nullable(),
    posterPath: z.string().optional().nullable(),
    backdropPath: z.string().optional().nullable(),
    releaseDate: z.string().optional().nullable(),
    firstAirDate: z.string().optional().nullable(),
    mediaInfo: MediaInfoSchema.optional().nullable(),
  })
  .passthrough();

export const SeerrResultsPageSchema = z
  .object({
    page: z.number().optional(),
    totalPages: z.number().optional(),
    totalResults: z.number().optional(),
    results: z.array(SeerrSearchResultSchema).optional(),
  })
  .passthrough();

const ExternalIdsSchema = z
  .object({
    imdbId: z.string().nullable().optional(),
    tvdbId: z.number().nullable().optional(),
  })
  .passthrough();

const SeerrGenreSchema = z
  .object({
    id: z.number().optional(),
    name: z.string(),
  })
  .passthrough();

const SeerrCreditPersonSchema = z
  .object({
    id: z.number().optional(),
    name: z.string().optional(),
    original_name: z.string().optional(),
    character: z.string().nullable().optional(),
    job: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    order: z.number().nullable().optional(),
    profilePath: z.string().nullable().optional(),
    profile_path: z.string().nullable().optional(),
  })
  .passthrough();

const SeerrCreditsSchema = z
  .object({
    cast: z.array(SeerrCreditPersonSchema).optional(),
    crew: z.array(SeerrCreditPersonSchema).optional(),
  })
  .passthrough();

const SeerrNamedSchema = z
  .object({
    id: z.number().optional(),
    name: z.string(),
  })
  .passthrough();

const SeerrRelatedVideoSchema = z
  .object({
    url: z.string().optional(),
    key: z.string().optional(),
    name: z.string().optional(),
    size: z.number().optional(),
    type: z.string().optional(),
    site: z.string().optional(),
  })
  .passthrough();

export const SeerrMovieDetailsSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    originalTitle: z.string().optional(),
    imdbId: z.string().nullable().optional(),
    externalIds: ExternalIdsSchema.nullable().optional(),
    overview: z.string().optional().nullable(),
    tagline: z.string().optional().nullable(),
    posterPath: z.string().optional().nullable(),
    backdropPath: z.string().optional().nullable(),
    releaseDate: z.string().optional().nullable(),
    runtime: z.number().optional().nullable(),
    genres: z.array(SeerrGenreSchema).optional(),
    productionCompanies: z.array(SeerrNamedSchema).optional(),
    keywords: z.array(SeerrNamedSchema).optional(),
    credits: SeerrCreditsSchema.optional().nullable(),
    relatedVideos: z.array(SeerrRelatedVideoSchema).optional().nullable(),
    mediaInfo: MediaInfoSchema.optional().nullable(),
  })
  .passthrough();

const SeerrTvSeasonSummarySchema = z
  .object({
    id: z.number().optional(),
    name: z.string().optional(),
    seasonNumber: z.number(),
    episodeCount: z.number().optional(),
    airDate: z.string().nullable().optional(),
    overview: z.string().nullable().optional(),
    posterPath: z.string().nullable().optional(),
  })
  .passthrough();

export const SeerrTvEpisodeSchema = z
  .object({
    id: z.number().optional(),
    name: z.string().optional(),
    episodeNumber: z.number(),
    seasonNumber: z.number().optional(),
    airDate: z.string().nullable().optional(),
    overview: z.string().nullable().optional(),
    stillPath: z.string().nullable().optional(),
    runtime: z.number().nullable().optional(),
  })
  .passthrough();

export const SeerrTvSeasonSchema = z
  .object({
    id: z.number().optional(),
    name: z.string().optional(),
    seasonNumber: z.number(),
    airDate: z.string().nullable().optional(),
    overview: z.string().nullable().optional(),
    posterPath: z.string().nullable().optional(),
    episodes: z.array(SeerrTvEpisodeSchema).optional(),
  })
  .passthrough();

export const SeerrTvDetailsSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    originalName: z.string().optional(),
    imdbId: z.string().nullable().optional(),
    externalIds: ExternalIdsSchema.nullable().optional(),
    overview: z.string().optional().nullable(),
    tagline: z.string().optional().nullable(),
    posterPath: z.string().optional().nullable(),
    backdropPath: z.string().optional().nullable(),
    firstAirDate: z.string().optional().nullable(),
    episodeRunTime: z.array(z.number()).optional(),
    genres: z.array(SeerrGenreSchema).optional(),
    status: z.string().optional(),
    numberOfSeasons: z.number().optional(),
    numberOfEpisodes: z.number().optional(),
    seasons: z.array(SeerrTvSeasonSummarySchema).optional(),
    createdBy: z.array(SeerrCreditPersonSchema).optional(),
    networks: z.array(SeerrNamedSchema).optional(),
    productionCompanies: z.array(SeerrNamedSchema).optional(),
    keywords: z.array(SeerrNamedSchema).optional(),
    credits: SeerrCreditsSchema.optional().nullable(),
    relatedVideos: z.array(SeerrRelatedVideoSchema).optional().nullable(),
    mediaInfo: MediaInfoSchema.optional().nullable(),
  })
  .passthrough();

export const SeerrMediaRequestSchema = z
  .object({
    id: z.number(),
    status: z.number().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    type: z.string().optional(),
    is4k: z.boolean().optional(),
    media: z
      .object({
        tmdbId: z.number().optional(),
        status: z.number().optional(),
        status4k: z.number().optional(),
        mediaType: z.string().optional(),
      })
      .passthrough()
      .optional()
      .nullable(),
    // Embedded TMDb-ish fields sometimes present on list payloads
    mediaType: z.string().optional(),
  })
  .passthrough();

export const SeerrRequestListSchema = z
  .object({
    pageInfo: z
      .object({
        pages: z.number().optional(),
        pageSize: z.number().optional(),
        results: z.number().optional(),
        page: z.number().optional(),
      })
      .passthrough()
      .optional(),
    results: z.array(SeerrMediaRequestSchema).optional(),
  })
  .passthrough();

export type SeerrSearchResult = z.infer<typeof SeerrSearchResultSchema>;
export type SeerrMovieDetails = z.infer<typeof SeerrMovieDetailsSchema>;
export type SeerrTvDetails = z.infer<typeof SeerrTvDetailsSchema>;
export type SeerrTvEpisode = z.infer<typeof SeerrTvEpisodeSchema>;
export type SeerrTvSeason = z.infer<typeof SeerrTvSeasonSchema>;
export type SeerrMediaInfo = z.infer<typeof MediaInfoSchema>;
export type SeerrMediaRequest = z.infer<typeof SeerrMediaRequestSchema>;
