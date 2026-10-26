import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReclinarrClient, uuidv7 } from "./api.js";
import { memoryStorage, type KeyValueStorage } from "./storage.js";

type Sent = { event: string; timestamp: string; properties: Record<string, unknown> };

function setup(storage: KeyValueStorage = memoryStorage()) {
  const batches: Sent[][] = [];
  const apiHeaders: Array<Record<string, string>> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.includes("posthog.com")) {
      batches.push(JSON.parse(init?.body as string).batch);
      return new Response("{}", { status: 200 });
    }
    if (url.endsWith("/api/telemetry/status")) {
      return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    }
    apiHeaders.push(init?.headers as Record<string, string>);
    return new Response(JSON.stringify({ items: [], onList: true }), { status: 200 });
  }) as typeof fetch;
  const client = new ReclinarrClient({ baseUrl: "", fetchImpl, storage, appVersion: "1.2.3" });
  return { client, storage, batches, apiHeaders };
}

async function optIn(client: ReclinarrClient) {
  await client.analyticsStatus();
  await client.setAnalyticsConsent("user-1", true);
}

async function flush() {
  await vi.advanceTimersByTimeAsync(5_000);
}

describe("telemetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates UUIDv7 ids carrying the creation time", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    const id = uuidv7(now);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(now);
  });

  it("sends nothing before the user opts in", async () => {
    const { client, batches } = setup();
    await client.analyticsStatus();
    client.trackScreen("home");
    client.trackFeature("request");
    await flush();
    expect(batches).toEqual([]);
  });

  it("tags every event with session, device and app properties", async () => {
    const { client, batches } = setup();
    await optIn(client);
    client.trackScreen("home");
    await client.toggleMyList("movie", 1);
    await flush();
    const events = batches.flat();
    expect(events.map((e) => e.event)).toEqual(["$pageview", "client.feature_used"]);
    const [pageview, feature] = events;
    expect(pageview!.properties).toMatchObject({ $screen_name: "home", $pathname: "/home" });
    expect(feature!.properties).toMatchObject({ feature: "my_list_add" });
    const sessionIds = new Set(events.map((e) => e.properties.$session_id));
    expect(sessionIds.size).toBe(1);
    for (const event of events) {
      expect(event.timestamp).toBe("2026-10-26T12:00:00.000Z");
      expect(event.properties).toMatchObject({
        platform: "web",
        $device_type: "Desktop",
        $app_version: "1.2.3",
        $lib: "reclinarr-client",
        environment: "production",
        $process_person_profile: false,
      });
    }
  });

  it("forwards the session to the API so server events join it", async () => {
    const { client, batches, apiHeaders } = setup();
    await optIn(client);
    await client.toggleMyList("movie", 1);
    await flush();
    const headers = apiHeaders.at(-1)!;
    expect(headers["x-reclinarr-client-device"]).toBe("Desktop");
    expect(headers["x-reclinarr-telemetry-session"]).toBe(batches.flat()[0]!.properties.$session_id);
  });

  it("rotates the session after 30 minutes idle and keeps it across restarts", async () => {
    const storage = memoryStorage();
    const first = setup(storage);
    await optIn(first.client);
    first.client.trackScreen("home");
    await flush();
    const original = first.batches.flat()[0]!.properties.$session_id;

    vi.advanceTimersByTime(10 * 60_000);
    const restarted = setup(storage);
    await optIn(restarted.client);
    restarted.client.trackScreen("movies");
    await flush();
    expect(restarted.batches.flat()[0]!.properties.$session_id).toBe(original);

    vi.advanceTimersByTime(31 * 60_000);
    restarted.client.trackScreen("search");
    await flush();
    const rotated = restarted.batches.flat().at(-1)!.properties.$session_id;
    expect(rotated).not.toBe(original);
  });

  it("drops the stored session when the user opts out", async () => {
    const { client, storage } = setup();
    await optIn(client);
    client.trackScreen("home");
    await flush();
    await client.setAnalyticsConsent("user-1", false);
    const key = `reclinarr.analytics.${encodeURIComponent("")}.user-1.session`;
    expect(await storage.getItem(key)).toBeNull();
  });

  it("marks events from dev builds as development", async () => {
    vi.stubGlobal("__DEV__", true);
    const { client, batches } = setup();
    await optIn(client);
    client.trackScreen("home");
    await flush();
    vi.unstubAllGlobals();
    expect(batches.flat()[0]!.properties.environment).toBe("development");
  });

  it("rejects feature names outside the allowlist", async () => {
    const { client, batches } = setup();
    await optIn(client);
    client.trackTelemetry("client.feature_used", { feature: "watched_some_title" });
    client.trackTelemetry("client.playback_milestone", { milestone: "playback_end", watched_s: 1.5 });
    await flush();
    expect(batches).toEqual([]);
  });
});
