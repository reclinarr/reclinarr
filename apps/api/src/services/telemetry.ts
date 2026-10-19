import { AsyncLocalStorage } from "node:async_hooks";

type MetricProperties = Record<string, string | number | boolean | null>;
type CapturedEvent = {
  event: string;
  properties: MetricProperties & { distinct_id: string; $process_person_profile: false };
  queuedAt: number;
};
type CaptureContext = { distinctId: string; platform?: string; appVersion?: string };

const EVENT_NAMES = new Set([
  "server.api_operation",
  "server.provider_operation",
  "client.api_operation",
  "client.screen_view",
  "client.playback_milestone",
  "client.artwork_result",
]);
const MAX_QUEUE = 500;

export class TelemetryService {
  private readonly currentContext = new AsyncLocalStorage<CaptureContext>();
  private readonly queue: CapturedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  readonly enabled: boolean;

  constructor(private readonly projectKey: string, disabled: boolean) {
    this.enabled = Boolean(projectKey) && !disabled;
  }

  runWithDistinctId<T>(
    distinctId: string | null,
    callback: () => T,
    metadata: { platform?: string; appVersion?: string } = {},
  ): T {
    if (!this.enabled || !distinctId || !/^[A-Za-z0-9_-]{16,80}$/.test(distinctId)) {
      return callback();
    }
    return this.currentContext.run({ distinctId, ...metadata }, callback);
  }

  captureClientBatch(
    distinctId: string,
    events: Array<{ event: string; properties: Record<string, unknown> }>,
    platform: string,
  ) {
    if (!this.enabled || !/^[A-Za-z0-9_-]{16,80}$/.test(distinctId)) return;
    for (const event of events.slice(0, 50)) {
      if (!EVENT_NAMES.has(event.event) || !isSafeProperties(event.event, event.properties)) continue;
      this.enqueue(event.event, distinctId, {
        ...event.properties as MetricProperties,
        platform,
      });
    }
  }

  captureCurrent(event: string, properties: MetricProperties) {
    const context = this.currentContext.getStore();
    if (!context || !EVENT_NAMES.has(event)) return;
    const enriched = {
      ...properties,
      ...(context.platform ? { platform: context.platform } : {}),
      ...(context.appVersion ? { app_version: context.appVersion } : {}),
    };
    if (!isSafeProperties(event, enriched)) return;
    this.enqueue(event, context.distinctId, enriched);
  }

  private enqueue(event: string, distinctId: string, properties: MetricProperties) {
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push({
      event,
      properties: { ...properties, distinct_id: distinctId, $process_person_profile: false },
      queuedAt: Date.now(),
    });
    if (this.queue.length >= 20) void this.flush();
    else this.scheduleFlush(10_000);
  }

  private scheduleFlush(delayMs: number) {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => void this.flush(), delayMs);
    this.flushTimer.unref?.();
  }

  private async flush() {
    if (this.flushing) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.enabled || this.queue.length === 0) return;
    this.flushing = true;
    const pending = this.queue.splice(0, 50);
    const events = pending.filter((event) => Date.now() - event.queuedAt <= 5 * 60_000);
    if (events.length === 0) {
      this.flushing = false;
      if (this.queue.length) void this.flush();
      return;
    }
    let succeeded = false;
    try {
      const response = await fetch("https://eu.i.posthog.com/batch/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: this.projectKey,
          batch: events.map(({ queuedAt: _queuedAt, ...event }) => ({
            ...event,
            properties: { ...event.properties, $geoip_disable: true },
          })),
        }),
        signal: AbortSignal.timeout(4_000),
      });
      succeeded = response.ok;
    } catch {
      // Best effort only; retry after the connection may have recovered.
    }
    if (!succeeded) {
      this.queue.unshift(...events);
      this.queue.splice(0, Math.max(0, this.queue.length - MAX_QUEUE));
    }
    this.flushing = false;
    if (this.queue.length) {
      if (succeeded) void this.flush();
      else this.scheduleFlush(15_000);
    }
  }
}

function isSafeProperties(event: string, properties: Record<string, unknown>): boolean {
  const common = new Set(["platform"]);
  const allowed: Record<string, Set<string>> = {
    "server.api_operation": new Set(["operation", "method", "duration_ms", "status", "outcome", "platform", "app_version"]),
    "server.provider_operation": new Set(["provider", "duration_ms", "status", "outcome", "platform", "app_version"]),
    "client.api_operation": new Set(["operation", "duration_ms", "outcome", "platform", "app_version"]),
    "client.screen_view": new Set(["screen", "platform", "app_version"]),
    "client.playback_milestone": new Set(["milestone", "duration_ms", "media_kind", "platform", "app_version"]),
    "client.artwork_result": new Set(["duration_ms", "outcome", "platform", "app_version"]),
  };
  const keys = allowed[event];
  if (!keys || Object.keys(properties).some((key) => !keys.has(key))) return false;
  for (const [key, value] of Object.entries(properties)) {
    if (common.has(key)) {
      if (value !== "web" && value !== "ios" && value !== "android") return false;
    } else if (key === "app_version") {
      if (typeof value !== "string" || !/^[0-9A-Za-z.+-]{1,32}$/.test(value)) return false;
    } else if (key === "duration_ms" || key === "status") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
    } else if (key === "outcome") {
      if (value !== "success" && value !== "failure") return false;
    } else if (key === "operation") {
      if (typeof value !== "string" || !/^[a-z_]{2,40}$/.test(value)) return false;
    } else if (key === "provider") {
      if (typeof value !== "string" || !/^[a-z_]{2,32}$/.test(value)) return false;
    } else if (key === "method") {
      if (value !== "GET" && value !== "POST" && value !== "PUT" && value !== "DELETE" && value !== "PATCH") return false;
    } else if (key === "screen" || key === "milestone") {
      if (typeof value !== "string" || !/^[a-z_]{2,32}$/.test(value)) return false;
    } else if (key === "media_kind") {
      if (value !== "vod" && value !== "live") return false;
    }
  }
  return true;
}
