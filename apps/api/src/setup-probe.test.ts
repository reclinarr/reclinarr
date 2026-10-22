import { describe, expect, it } from "vitest";
import { probeSetupService } from "./setup-probe.js";

function jsonFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status = 200, body } = handler(String(input), init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("setup connection tests", () => {
  it("reports a reachable Jellyfin server", async () => {
    const seen: string[] = [];
    const result = await probeSetupService({
      service: "jellyfin",
      JELLYFIN_URL: "http://jellyfin.local:8096/",
      fetchImpl: jsonFetch((url) => {
        seen.push(url);
        return { body: { ServerName: "Jellyfin", Version: "10.10.7" } };
      }),
    });
    expect(result).toEqual({ ok: true, message: "Connected to Jellyfin 10.10.7." });
    expect(seen).toEqual(["http://jellyfin.local:8096/System/Info/Public"]);
  });

  it("explains when Jellyfin cannot be reached", async () => {
    const result = await probeSetupService({
      service: "jellyfin",
      JELLYFIN_URL: "http://127.0.0.1:9",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Could not reach Jellyfin. Check the address and that the server is running.");
  });

  it("rejects an address that is not http or https", async () => {
    let called = false;
    const result = await probeSetupService({
      service: "jellyfin",
      JELLYFIN_URL: "file:///etc/passwd",
      fetchImpl: jsonFetch(() => {
        called = true;
        return { body: {} };
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/http/);
    expect(called).toBe(false);
  });

  it("checks the Seerr API key after the server answers", async () => {
    const paths: string[] = [];
    const result = await probeSetupService({
      service: "seerr",
      SEERR_URL: "http://seerr.local:5055",
      SEERR_API_KEY: "secret-key",
      fetchImpl: jsonFetch((url) => {
        paths.push(new URL(url).pathname);
        if (url.includes("/request")) return { status: 401, body: { message: "unauthorized" } };
        return { body: { version: "3.0.0" } };
      }),
    });
    expect(paths).toEqual(["/api/v1/status", "/api/v1/request"]);
    expect(result).toEqual({ ok: false, message: "Seerr rejected the API key." });
  });

  it("tells you when Seerr is up and the API key is still empty", async () => {
    const result = await probeSetupService({
      service: "seerr",
      SEERR_URL: "http://seerr.local:5055",
      fetchImpl: jsonFetch(() => ({ body: { version: "3.0.0" } })),
    });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/API key/);
  });

  it("requires Dispatcharr credentials before calling the server", async () => {
    let called = false;
    const result = await probeSetupService({
      service: "dispatcharr",
      DISPATCHARR_URL: "http://dispatcharr.local:9191",
      fetchImpl: jsonFetch(() => {
        called = true;
        return { body: {} };
      }),
    });
    expect(result).toEqual({ ok: false, message: "Add an API key, or a username and password." });
    expect(called).toBe(false);
  });

  it("connects to Dispatcharr with an API key", async () => {
    const result = await probeSetupService({
      service: "dispatcharr",
      DISPATCHARR_URL: "http://dispatcharr.local:9191",
      DISPATCHARR_API_KEY: "dispatch-key",
      fetchImpl: jsonFetch((url) => {
        expect(url).toContain("/api/vod/movies/");
        return { body: { count: 0, results: [] } };
      }),
    });
    expect(result).toEqual({ ok: true, message: "Connected to Dispatcharr." });
  });

  it("requires a Bazarr API key", async () => {
    const result = await probeSetupService({
      service: "bazarr",
      BAZARR_URL: "http://bazarr.local:6767",
    });
    expect(result).toEqual({ ok: false, message: "Enter the Bazarr API key." });
  });

  it("connects to Bazarr when the status call succeeds", async () => {
    const result = await probeSetupService({
      service: "bazarr",
      BAZARR_URL: "http://bazarr.local:6767",
      BAZARR_API_KEY: "bazarr-key",
      fetchImpl: jsonFetch(() => ({ body: { data: { bazarr_version: "1.5.1" } } })),
    });
    expect(result).toEqual({ ok: true, message: "Connected to Bazarr 1.5.1." });
  });
});
