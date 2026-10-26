import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryService } from "./telemetry.js";

const DISTINCT_ID = "0123456789abcdef0123";
const SESSION_ID = "019a2000-0000-7000-8000-000000000000";

describe("TelemetryService", () => {
  let sent: Array<{ event: string; timestamp: string; properties: Record<string, unknown> }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
    sent = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(...JSON.parse(init.body as string).batch);
      return new Response("{}", { status: 200 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("joins server events to the client session and device", async () => {
    const telemetry = new TelemetryService("phc_test", false, "development");
    telemetry.runWithDistinctId(
      DISTINCT_ID,
      () => telemetry.captureCurrent("server.api_operation", {
        operation: "home",
        method: "GET",
        duration_ms: 12,
        status: 200,
        outcome: "success",
      }),
      { platform: "android", appVersion: "1.2.3", sessionId: SESSION_ID, deviceType: "TV" },
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      event: "server.api_operation",
      timestamp: "2026-10-26T12:00:00.000Z",
      properties: {
        distinct_id: DISTINCT_ID,
        $session_id: SESSION_ID,
        $device_type: "TV",
        platform: "android",
        environment: "development",
      },
    });
  });

  it("drops events whose session header is not a UUIDv7", async () => {
    const telemetry = new TelemetryService("phc_test", false, "development");
    telemetry.runWithDistinctId(
      DISTINCT_ID,
      () => telemetry.captureCurrent("server.provider_operation", {
        provider: "jellyfin",
        duration_ms: 5,
        status: 200,
        outcome: "success",
      }),
      { sessionId: "not-a-session" },
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toEqual([]);
  });
});
