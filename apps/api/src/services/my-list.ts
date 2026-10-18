import { eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { settings } from "../db/schema.js";

export type MyListKey = `${"movie" | "tv"}:${number}`;

function keyFor(userId: string): string {
  return `mylist.${userId}`;
}

export function myListKey(mediaType: "movie" | "tv", tmdbId: number): MyListKey {
  return `${mediaType}:${tmdbId}`;
}

export function parseMyListKey(raw: string): { mediaType: "movie" | "tv"; tmdbId: number } | null {
  const m = /^(movie|tv):(\d+)$/.exec(raw);
  if (!m) return null;
  return { mediaType: m[1] as "movie" | "tv", tmdbId: Number(m[2]) };
}

export class MyListStore {
  constructor(private readonly db: AppDb) {}

  list(userId: string): MyListKey[] {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, keyFor(userId)))
      .all()[0];
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((x): x is MyListKey => typeof x === "string" && parseMyListKey(x) != null);
    } catch {
      return [];
    }
  }

  set(userId: string, keys: MyListKey[]): MyListKey[] {
    const unique = [...new Set(keys)];
    const now = new Date();
    this.db
      .insert(settings)
      .values({
        key: keyFor(userId),
        value: JSON.stringify(unique),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(unique), updatedAt: now },
      })
      .run();
    return unique;
  }

  has(userId: string, mediaType: "movie" | "tv", tmdbId: number): boolean {
    return this.list(userId).includes(myListKey(mediaType, tmdbId));
  }

  toggle(
    userId: string,
    mediaType: "movie" | "tv",
    tmdbId: number,
  ): { items: MyListKey[]; onList: boolean } {
    const key = myListKey(mediaType, tmdbId);
    const cur = this.list(userId);
    const has = cur.includes(key);
    const next = has ? cur.filter((x) => x !== key) : [key, ...cur];
    return { items: this.set(userId, next), onList: !has };
  }
}
