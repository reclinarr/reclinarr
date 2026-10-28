import { describe, expect, it } from "vitest";
import { fetchFollowingRedirects } from "./http.js";

function recordingFetch(routes: Record<string, Response | (() => Response)>) {
  const calls: Array<{ url: string; headers: Headers; method: string }> = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers), method: init?.method ?? "GET" });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return typeof route === "function" ? route() : route;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { location } });

describe("fetchFollowingRedirects", () => {
  it("drops credentials when a redirect leaves the original origin", async () => {
    const { fetchImpl, calls } = recordingFetch({
      "https://dispatcharr.example/proxy/ts/stream/1": redirect("https://iptv-provider.example/live/1"),
      "https://iptv-provider.example/live/1": () => new Response("ok"),
    });
    const res = await fetchFollowingRedirects(fetchImpl, "https://dispatcharr.example/proxy/ts/stream/1", {
      headers: { "CF-Access-Client-Secret": "secret", "X-Api-Key": "key", Range: "bytes=0-" },
    });
    expect(await res.text()).toBe("ok");
    expect(calls[0]!.headers.get("cf-access-client-secret")).toBe("secret");
    expect(calls[1]!.headers.get("cf-access-client-secret")).toBeNull();
    expect(calls[1]!.headers.get("x-api-key")).toBeNull();
    expect(calls[1]!.headers.get("range")).toBe("bytes=0-");
  });

  it("keeps credentials on same-origin redirects", async () => {
    const { fetchImpl, calls } = recordingFetch({
      "https://seerr.example/api/v1/status": redirect("/api/v1/status/", 301),
      "https://seerr.example/api/v1/status/": () => new Response("{}"),
    });
    await fetchFollowingRedirects(fetchImpl, "https://seerr.example/api/v1/status", { headers: { "X-Api-Key": "key" } });
    expect(calls[1]!.headers.get("x-api-key")).toBe("key");
  });

  it("gives up after too many redirects", async () => {
    const { fetchImpl } = recordingFetch({ "https://loop.example/": redirect("https://loop.example/") });
    await expect(fetchFollowingRedirects(fetchImpl, "https://loop.example/")).rejects.toThrow(/Too many redirects/);
  });
});
