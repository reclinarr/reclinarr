import { afterEach, describe, expect, it, vi } from "vitest";
import { DispatcharrProvider } from "./provider.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function channel(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: n,
    uuid: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    name: `Channel ${n}`,
    channel_number: n,
    channel_group_id: 1,
    ...extra,
  };
}

/** Fake Dispatcharr serving `total` channels in pages of 100. */
function fakeDispatcharr(
  total: number,
  opts: { delayMs?: number; failChannels?: () => boolean; gate?: () => Promise<void> } = {},
) {
  const pageRequests: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/channels/groups/") {
      return jsonResponse([
        { id: 1, name: "Entertainment" },
        { id: 2, name: "Empty" },
        { id: 3, name: "News" },
      ]);
    }
    if (url.pathname === "/api/channels/channels/") {
      if (opts.failChannels?.()) return jsonResponse({ detail: "boom" }, 500);
      const page = Number(url.searchParams.get("page"));
      pageRequests.push(page);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      await opts.gate?.();
      inFlight -= 1;
      const start = (page - 1) * 100;
      const results = Array.from({ length: Math.max(0, Math.min(100, total - start)) }, (_, i) =>
        channel(start + i + 1, {
          ...(start + i + 1 === 5 ? { hidden_from_output: true } : {}),
          ...((start + i + 1) % 10 === 0 ? { channel_group_id: 3 } : {}),
        }),
      );
      return jsonResponse({ count: total, results });
    }
    return jsonResponse({ detail: "not found" }, 404);
  };
  const provider = new DispatcharrProvider({
    baseUrl: "https://dispatcharr.test",
    auth: { type: "apiKey", apiKey: "test" },
    fetchImpl,
  });
  return {
    provider,
    pageRequests,
    maxInFlight: () => maxInFlight,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Dispatcharr channel lineup", () => {
  it("fetches the remaining pages in parallel and keeps channel order", async () => {
    const { provider, pageRequests, maxInFlight } = fakeDispatcharr(650, { delayMs: 5 });

    const pages = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map((page) => provider.listChannels({ page, pageSize: 100 })),
    );
    const items = pages.flatMap((p) => p.items);

    expect(pages[0]?.total).toBe(649);
    expect(items.map((c) => c.number)).toEqual(
      Array.from({ length: 650 }, (_, i) => i + 1).filter((n) => n !== 5),
    );
    expect(items[0]?.groupName).toBe("Entertainment");
    expect([...pageRequests].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(maxInFlight()).toBeGreaterThan(1);
  });

  it("shares one upstream load between concurrent callers", async () => {
    const { provider, pageRequests } = fakeDispatcharr(250, { delayMs: 5 });

    await Promise.all([
      provider.listChannels({ page: 1 }),
      provider.listChannels({ page: 2 }),
      provider.getChannel(channel(1).uuid),
    ]);

    expect(pageRequests).toHaveLength(3);
  });

  it("serves the stale lineup at once and refreshes it in the background", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    const upstream: { held?: Promise<void> } = {};
    let release: (() => void) | undefined;
    const { provider, pageRequests } = fakeDispatcharr(150, {
      gate: () => upstream.held ?? Promise.resolve(),
    });
    await provider.listChannels({ page: 1 });
    expect(pageRequests).toHaveLength(2);

    upstream.held = new Promise((r) => {
      release = r;
    });
    now.mockReturnValue(1_000_000 + 61_000);
    // Upstream is held open, so this only resolves if the stale copy is served.
    const stale = await provider.listChannels({ page: 1 });

    expect(stale.total).toBe(149);
    await vi.waitFor(() => expect(pageRequests.length).toBeGreaterThan(2));
    release?.();
    await vi.waitFor(() => expect(pageRequests).toHaveLength(4));
  });

  it("lists only groups that hold visible channels, with their counts", async () => {
    const { provider } = fakeDispatcharr(100);

    await expect(provider.listChannelGroups()).resolves.toEqual([
      { id: "1", name: "Entertainment", channelCount: 89 },
      { id: "3", name: "News", channelCount: 10 },
    ]);
  });

  it("does not cache a failed first load", async () => {
    let fail = true;
    const { provider } = fakeDispatcharr(50, { failChannels: () => fail });

    await expect(provider.listChannels({ page: 1 })).rejects.toThrow();
    fail = false;
    await expect(provider.listChannels({ page: 1 })).resolves.toMatchObject({ total: 49 });
  });

  it("keeps serving the previous lineup when a background refresh fails", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(2_000_000);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = false;
    const { provider } = fakeDispatcharr(50, { failChannels: () => fail });
    await provider.listChannels({ page: 1 });

    fail = true;
    now.mockReturnValue(2_000_000 + 61_000);
    await expect(provider.listChannels({ page: 1 })).resolves.toMatchObject({ total: 49 });
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
  });
});
