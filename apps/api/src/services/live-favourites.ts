import { eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { settings } from "../db/schema.js";

function keyFor(userId: string): string {
  return `live.favourites.${userId}`;
}

export class LiveFavouritesStore {
  constructor(private readonly db: AppDb) {}

  list(userId: string): string[] {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, keyFor(userId)))
      .all()[0];
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  set(userId: string, uuids: string[]): string[] {
    const unique = [...new Set(uuids)];
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

  toggle(userId: string, uuid: string): { favourites: string[]; favourite: boolean } {
    const cur = this.list(userId);
    const has = cur.includes(uuid);
    const next = has ? cur.filter((x) => x !== uuid) : [...cur, uuid];
    return { favourites: this.set(userId, next), favourite: !has };
  }
}
