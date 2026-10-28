import { describe, expect, it } from "vitest";
import { SeerrProvider } from "./provider.js";

function seerrStub() {
  const calls: Array<{ url: URL; headers: Headers; method: string }> = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers), method: init?.method ?? "GET" });
    if (url.pathname === "/api/v1/user") {
      return Response.json({
        pageInfo: { pages: 1 },
        results: [
          { id: 1, jellyfinUserId: null },
          { id: 7, jellyfinUserId: "ABCDEF0123456789abcdef0123456789" },
        ],
      });
    }
    if (url.pathname === "/api/v1/request" && init?.method === "POST") return Response.json({ id: 1 });
    if (url.pathname === "/api/v1/request") return Response.json({ pageInfo: { results: 0 }, results: [] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { provider: new SeerrProvider({ baseUrl: "http://seerr.test", apiKey: "admin-key", fetchImpl }), calls };
}

describe("Seerr per-user requests", () => {
  it("finds the Seerr account imported for a Jellyfin user", async () => {
    const { provider } = seerrStub();
    expect(await provider.seerrUserIdForJellyfin("abcdef01-2345-6789-abcd-ef0123456789")).toBe(7);
    expect(await provider.seerrUserIdForJellyfin("ffffffffffffffffffffffffffffffff")).toBeNull();
  });

  it("creates and lists requests as that user", async () => {
    const { provider, calls } = seerrStub();
    await provider.requestMedia({ tmdbId: 603, mediaType: "movie" }, { asUser: 7, is4k: true });
    await provider.listRequests({ asUser: 7 });
    const seerrCalls = calls.filter((c) => c.url.pathname === "/api/v1/request");
    expect(seerrCalls).toHaveLength(2);
    for (const call of seerrCalls) {
      expect(call.headers.get("x-api-user")).toBe("7");
      expect(call.headers.get("x-api-key")).toBe("admin-key");
    }
  });
});
