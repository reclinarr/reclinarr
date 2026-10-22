import { and, eq } from "drizzle-orm";
import type { Media } from "@reclinarr/shared";
import { isObviousLanguageMismatch } from "@reclinarr/shared";
import type { AppDb } from "../db/client.js";
import { dispatcharrTmdbIndex } from "../db/schema.js";

export function rememberDispatcharrMedia(db: AppDb, media: Media): void {
  const tmdbId = media.identity.tmdbId;
  const mediaType = media.identity.mediaType;
  if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv")) return;

  const da = media.availability.find((a) => a.provider === "dispatcharr");
  if (!da?.uuid) return;

  const dispatcharrId = da.movieId ?? da.seriesId;
  if (dispatcharrId === undefined) return;

  try {
    db.insert(dispatcharrTmdbIndex)
      .values({
        tmdbId,
        mediaType,
        dispatcharrId,
        uuid: da.uuid,
        streamId: da.candidates?.[0]?.streamId,
        title: media.metadata.title,
        catalogueLanguage: da.catalogueLanguage ?? null,
        languageConfidence: da.languageConfidence ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dispatcharrTmdbIndex.tmdbId, dispatcharrTmdbIndex.mediaType],
        set: {
          dispatcharrId,
          uuid: da.uuid,
          streamId: da.candidates?.[0]?.streamId,
          title: media.metadata.title,
          catalogueLanguage: da.catalogueLanguage ?? null,
          languageConfidence: da.languageConfidence ?? null,
          updatedAt: new Date(),
        },
      })
      .run();
  } catch {
    // index is best-effort
  }
}

/**
 * A cached pick is only trusted when its language is known and preferred.
 * Rows without a language (legacy untagged picks) are never offered for play.
 */
function isTrustedIndexRow(
  row: { catalogueLanguage: string | null; languageConfidence: string | null },
  preferredLanguages?: string[],
): boolean {
  if (!row.catalogueLanguage && row.languageConfidence !== "corroborated") return false;
  if (
    preferredLanguages?.length &&
    isObviousLanguageMismatch(preferredLanguages, row.catalogueLanguage ?? undefined)
  ) {
    return false;
  }
  return true;
}

export function lookupDispatcharrIndex(
  db: AppDb,
  tmdbId: number,
  mediaType: "movie" | "tv",
  preferredLanguages?: string[],
): {
  uuid: string;
  streamId?: string | null;
  dispatcharrId: number;
  catalogueLanguage?: string | null;
  languageConfidence?: string | null;
} | null {
  const rows = db
    .select()
    .from(dispatcharrTmdbIndex)
    .where(
      and(eq(dispatcharrTmdbIndex.tmdbId, tmdbId), eq(dispatcharrTmdbIndex.mediaType, mediaType)),
    )
    .all();
  const hit = rows[0];
  if (!hit) return null;

  if (!isTrustedIndexRow(hit, preferredLanguages)) {
    // Untrusted or wrong-language pick — drop it and force a re-search.
    try {
      db.delete(dispatcharrTmdbIndex)
        .where(
          and(
            eq(dispatcharrTmdbIndex.tmdbId, tmdbId),
            eq(dispatcharrTmdbIndex.mediaType, mediaType),
          ),
        )
        .run();
    } catch {
      // index is best-effort
    }
    return null;
  }

  return {
    uuid: hit.uuid,
    streamId: hit.streamId,
    dispatcharrId: hit.dispatcharrId,
    catalogueLanguage: hit.catalogueLanguage,
    languageConfidence: hit.languageConfidence,
  };
}
