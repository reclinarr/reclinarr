import { and, eq, lt, or, sql } from "drizzle-orm";
import {
  pickPreferredByCatalogueLanguage,
  tmdbLanguageReference,
  type Media,
  type PlayableLanguageConfidence,
  type TmdbLanguageReference,
} from "@reclinarr/shared";
import type { DiscoveryProvider, DispatcharrProvider } from "@reclinarr/providers";
import type { AppDb } from "../db/client.js";
import { dispatcharrTmdbIndex } from "../db/schema.js";
import { MOVIE_GENRE_RAILS, TV_GENRE_RAILS } from "./catalog-genres.js";

export interface VodCatalogCandidate {
  dispatcharrId: number;
  uuid: string;
  name: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
}

export interface VodCatalogWinner {
  tmdbId: number;
  mediaType: "movie" | "tv";
  dispatcharrId: number;
  uuid: string;
  title: string;
  catalogueLanguage?: string;
  languageConfidence: PlayableLanguageConfidence;
}

/**
 * Group catalogue rows by TMDb id, rank language variants, keep one winner each.
 * Rows without a TMDb id must already have been filtered out by the caller.
 * Without a TMDb reference per group only explicitly tagged copies can win.
 */
export function pickCatalogWinners(
  candidates: VodCatalogCandidate[],
  preferredLanguages: string[],
  references?: Map<string, TmdbLanguageReference>,
): VodCatalogWinner[] {
  const groups = new Map<string, VodCatalogCandidate[]>();
  for (const c of candidates) {
    const key = `${c.mediaType}:${c.tmdbId}`;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const winners: VodCatalogWinner[] = [];
  for (const [key, group] of groups) {
    const best = pickPreferredByCatalogueLanguage(group, preferredLanguages, {
      nameOf: (item) => item.name,
      idOf: (item) => item.dispatcharrId,
      reference: references?.get(key),
    });
    if (!best) continue;
    winners.push({
      tmdbId: best.item.tmdbId,
      mediaType: best.item.mediaType,
      dispatcharrId: best.item.dispatcharrId,
      uuid: best.item.uuid,
      title: best.item.name,
      catalogueLanguage: best.catalogueLanguage,
      languageConfidence: best.confidence,
    });
  }
  return winners;
}

export function applyCatalogWinners(
  db: AppDb,
  winners: VodCatalogWinner[],
  syncedAt: Date,
  opts?: { pruneStale?: boolean },
): { upserted: number; removed: number } {
  const now = syncedAt;
  for (const w of winners) {
    db.insert(dispatcharrTmdbIndex)
      .values({
        tmdbId: w.tmdbId,
        mediaType: w.mediaType,
        dispatcharrId: w.dispatcharrId,
        uuid: w.uuid,
        streamId: null,
        title: w.title,
        catalogueLanguage: w.catalogueLanguage ?? null,
        languageConfidence: w.languageConfidence,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [dispatcharrTmdbIndex.tmdbId, dispatcharrTmdbIndex.mediaType],
        set: {
          dispatcharrId: w.dispatcharrId,
          uuid: w.uuid,
          title: w.title,
          catalogueLanguage: w.catalogueLanguage ?? null,
          languageConfidence: w.languageConfidence,
          updatedAt: now,
        },
      })
      .run();
  }

  // Hot-title warm never prunes — opportunistic index hits must survive.
  let removed = 0;
  if (opts?.pruneStale === true) {
    removed = db
      .delete(dispatcharrTmdbIndex)
      .where(lt(dispatcharrTmdbIndex.updatedAt, now))
      .run().changes;
  }

  return { upserted: winners.length, removed };
}

export interface HotVodTarget {
  tmdbId: number;
  mediaType: "movie" | "tv";
  titleHint?: string;
  yearHint?: number;
  reference?: TmdbLanguageReference;
}

const WARM_CONCURRENCY = 2;
const WARM_RETRIES = 3;

function pushMediaTargets(into: Map<string, HotVodTarget>, items: Media[]): void {
  for (const item of items) {
    const tmdbId = item.identity.tmdbId;
    const mediaType = item.identity.mediaType;
    if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv")) continue;
    const key = `${mediaType}:${tmdbId}`;
    if (into.has(key)) continue;
    into.set(key, {
      tmdbId,
      mediaType,
      titleHint: item.metadata.title,
      yearHint: item.metadata.year,
      reference: tmdbLanguageReference(item.metadata),
    });
  }
}

/** Collect unique hot TMDb titles from the same Seerr page‑1 rails the UI shows. */
export async function collectHotVodTargets(seerr: DiscoveryProvider): Promise<HotVodTarget[]> {
  const byKey = new Map<string, HotVodTarget>();

  const homeRails = await Promise.all([
    seerr.discoverTrending({ page: 1 }).catch(() => [] as Media[]),
    seerr.discoverMovies
      ? seerr.discoverMovies({ page: 1 }).catch(() => [] as Media[])
      : Promise.resolve([] as Media[]),
    seerr.discoverTv
      ? seerr.discoverTv({ page: 1 }).catch(() => [] as Media[])
      : Promise.resolve([] as Media[]),
  ]);
  for (const rail of homeRails) pushMediaTargets(byKey, rail);

  const catalogRails = await Promise.all([
    seerr.discoverTrending({ page: 1, mediaType: "movie" }).catch(() => [] as Media[]),
    seerr.discoverTrending({ page: 1, mediaType: "tv" }).catch(() => [] as Media[]),
    seerr.discoverMovies
      ? seerr.discoverMovies({ page: 1 }).catch(() => [] as Media[])
      : Promise.resolve([] as Media[]),
    seerr.discoverTv
      ? seerr.discoverTv({ page: 1 }).catch(() => [] as Media[])
      : Promise.resolve([] as Media[]),
    ...MOVIE_GENRE_RAILS.map((g) =>
      seerr.discoverMovies
        ? seerr.discoverMovies({ page: 1, genreId: g.genreId }).catch(() => [] as Media[])
        : Promise.resolve([] as Media[]),
    ),
    ...TV_GENRE_RAILS.map((g) =>
      seerr.discoverTv
        ? seerr.discoverTv({ page: 1, genreId: g.genreId }).catch(() => [] as Media[])
        : Promise.resolve([] as Media[]),
    ),
  ]);
  for (const rail of catalogRails) pushMediaTargets(byKey, rail);

  return [...byKey.values()];
}

async function resolveHotTarget(
  dispatcharr: DispatcharrProvider,
  target: HotVodTarget,
): Promise<VodCatalogWinner | null> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= WARM_RETRIES; attempt++) {
    try {
      const match = await dispatcharr.findVodCatalogueMatch(target.tmdbId, target.mediaType, {
        titleHint: target.titleHint,
        yearHint: target.yearHint,
        reference: target.reference,
      });
      if (!match) return null;
      return {
        tmdbId: target.tmdbId,
        mediaType: target.mediaType,
        dispatcharrId: match.id,
        uuid: match.uuid,
        title: match.name,
        catalogueLanguage: match.catalogueLanguage,
        languageConfidence: match.languageConfidence,
      };
    } catch (err) {
      lastErr = err;
      const delayMs = attempt * 1_500;
      console.warn(
        `[vod-index] ${target.mediaType}:${target.tmdbId} attempt ${attempt}/${WARM_RETRIES} failed — retry in ${delayMs}ms`,
        err instanceof Error ? err.message : err,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.warn(
    `[vod-index] ${target.mediaType}:${target.tmdbId} skipped after retries`,
    lastErr instanceof Error ? lastErr.message : lastErr,
  );
  return null;
}

export interface VodCatalogSyncResult {
  targets: number;
  found: number;
  missed: number;
  movies: number;
  series: number;
  upserted: number;
  removed: number;
}

/**
 * Warm the Dispatcharr TMDb index from Seerr hot discovery titles (page‑1 rails).
 * Does not page the full IPTV catalogue.
 */
export async function syncVodCatalog(opts: {
  db: AppDb;
  dispatcharr: DispatcharrProvider;
  seerr: DiscoveryProvider;
  preferredLanguages: string[];
}): Promise<VodCatalogSyncResult> {
  const targets = await collectHotVodTargets(opts.seerr);
  console.info(`[vod-index] warming ${targets.length} hot title(s)`);

  const winners: VodCatalogWinner[] = [];
  let next = 0;
  let missed = 0;

  const worker = async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= targets.length) return;
      const target = targets[i]!;
      const hit = await resolveHotTarget(opts.dispatcharr, target);
      if (hit) winners.push(hit);
      else missed += 1;
      const done = winners.length + missed;
      if (done % 25 === 0 || done >= targets.length) {
        console.info(
          `[vod-index] warm ${done}/${targets.length} (found=${winners.length} missed=${missed})`,
        );
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(WARM_CONCURRENCY, Math.max(1, targets.length)) },
    () => worker(),
  );
  await Promise.all(workers);

  const syncedAt = new Date();
  const { upserted, removed } = applyCatalogWinners(opts.db, winners, syncedAt, {
    pruneStale: false,
  });

  const movies = winners.filter((w) => w.mediaType === "movie").length;
  const series = winners.filter((w) => w.mediaType === "tv").length;

  return {
    targets: targets.length,
    found: winners.length,
    missed,
    movies,
    series,
    upserted,
    removed,
  };
}

export function startVodCatalogSync(opts: {
  db: AppDb;
  dispatcharr: DispatcharrProvider;
  seerr: DiscoveryProvider;
  preferredLanguages: string[];
  intervalMs: number;
  enabled: boolean;
}): { stop: () => void } {
  if (!opts.enabled || opts.intervalMs <= 0) {
    return { stop: () => undefined };
  }

  let running = false;
  let stopped = false;

  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await syncVodCatalog(opts);
      console.info(
        `[vod-index] warmed targets=${result.targets} found=${result.found} missed=${result.missed} upserted=${result.upserted}`,
      );
    } catch (err) {
      console.error("[vod-index] sync failed — previous index kept", err);
    } finally {
      running = false;
    }
  };

  // First pass shortly after startup so home rails can enrich without waiting a full interval.
  const bootTimer = setTimeout(() => {
    void run();
  }, 5_000);
  bootTimer.unref?.();

  const interval = setInterval(() => {
    void run();
  }, opts.intervalMs);
  interval.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearTimeout(bootTimer);
      clearInterval(interval);
    },
  };
}

/** True when every (tmdbId, mediaType) pair is present in the index. */
export function indexedTmdbKeys(
  db: AppDb,
  keys: Array<{ tmdbId: number; mediaType: "movie" | "tv" }>,
): Set<string> {
  const out = new Set<string>();
  if (!keys.length) return out;

  // SQLite handles moderate IN lists well; chunk to stay under parameter limits.
  const CHUNK = 200;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const clauses = chunk.map(
      (k) =>
        and(
          eq(dispatcharrTmdbIndex.tmdbId, k.tmdbId),
          eq(dispatcharrTmdbIndex.mediaType, k.mediaType),
        ),
    );
    const rows = db
      .select({
        tmdbId: dispatcharrTmdbIndex.tmdbId,
        mediaType: dispatcharrTmdbIndex.mediaType,
      })
      .from(dispatcharrTmdbIndex)
      .where(or(...clauses))
      .all();
    for (const row of rows) {
      out.add(`${row.mediaType}:${row.tmdbId}`);
    }
  }
  return out;
}

/** Count of indexed VOD titles (for health / diagnostics). */
export function vodIndexCount(db: AppDb): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(dispatcharrTmdbIndex)
    .all()[0];
  return Number(row?.n ?? 0);
}
