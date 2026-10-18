import { randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { sessions } from "../db/schema.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
export const SESSION_COOKIE = "streamerr_session";
export const SESSION_HEADER = "x-streamerr-session";

export interface SessionRecord {
  id: string;
  jellyfinUserId: string;
  jellyfinUsername: string;
  jellyfinAccessToken: string;
  deviceId: string;
  deviceName: string;
  createdAt: Date;
  expiresAt: Date;
}

export class SessionService {
  constructor(private readonly db: AppDb) {}

  async create(input: {
    jellyfinUserId: string;
    jellyfinUsername: string;
    jellyfinAccessToken: string;
    deviceId: string;
    deviceName: string;
  }): Promise<SessionRecord> {
    const id = randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    this.db.insert(sessions).values({
      id,
      jellyfinUserId: input.jellyfinUserId,
      jellyfinUsername: input.jellyfinUsername,
      jellyfinAccessToken: input.jellyfinAccessToken,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      createdAt: now,
      expiresAt,
    }).run();
    return {
      id,
      ...input,
      createdAt: now,
      expiresAt,
    };
  }

  async get(id: string): Promise<SessionRecord | null> {
    const row = this.db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) {
      await this.destroy(id);
      return null;
    }
    return row;
  }

  async destroy(id: string): Promise<void> {
    this.db.delete(sessions).where(eq(sessions.id, id)).run();
  }

  async purgeExpired(): Promise<void> {
    this.db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
  }
}
