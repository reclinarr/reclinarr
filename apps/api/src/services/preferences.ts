import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../db/client.js";
import { settings } from "../db/schema.js";

export const preferencesSchema = z.object({
  audioLanguage: z.string().min(1).max(16).nullable(),
  subtitles: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("off") }),
    z.object({
      mode: z.literal("on"),
      language: z.string().max(16),
      forced: z.boolean().optional(),
      hearingImpaired: z.boolean().optional(),
    }),
  ]),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export const preferencesPatchSchema = preferencesSchema.partial();

export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

const DEFAULTS: Preferences = { audioLanguage: null, subtitles: { mode: "off" } };

function keyFor(userId: string): string {
  return `preferences.${userId}`;
}

export class PreferencesStore {
  constructor(private readonly db: AppDb) {}

  /** `null` when the user has never saved preferences. */
  find(userId: string): Preferences | null {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, keyFor(userId)))
      .all()[0];
    return row ? preferencesSchema.parse(JSON.parse(row.value)) : null;
  }

  get(userId: string): Preferences {
    return this.find(userId) ?? DEFAULTS;
  }

  update(userId: string, patch: PreferencesPatch): Preferences {
    const next = preferencesSchema.parse({ ...this.get(userId), ...patch });
    const value = JSON.stringify(next);
    const now = new Date();
    this.db
      .insert(settings)
      .values({ key: keyFor(userId), value, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
      .run();
    return next;
  }
}
