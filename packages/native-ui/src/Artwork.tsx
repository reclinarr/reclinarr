import { useEffect, useRef, useState } from "react";
import { Image, type ImageResizeMode, type ImageStyle, type StyleProp } from "react-native";
import { SESSION_COOKIE, SESSION_HEADER, trackTelemetry, tryGetClient } from "@reclinarr/client";

/**
 * Proxied `/api/images/*` URLs need the session. RN Image often drops custom headers
 * on Android, so the session also goes in the query string (server accepts it).
 */
export function artworkUri(
  url: string | undefined | null,
  maxWidth?: number,
  sessionId?: string | null,
  baseUrl?: string | null,
): string | undefined {
  if (!url) return undefined;
  const base = baseUrl ?? tryGetClient()?.baseUrl;
  if (!base) return url;
  try {
    const parsed = new URL(url, base);
    if (!parsed.pathname.startsWith("/api/")) return parsed.href;
    if (maxWidth) {
      parsed.searchParams.set("maxWidth", String(maxWidth));
      parsed.searchParams.set("quality", "80");
    }
    if (sessionId) {
      parsed.searchParams.set(SESSION_COOKIE, sessionId);
    }
    const path = `${parsed.pathname}${parsed.search}`;
    return new URL(path, base.endsWith("/") ? base : `${base}/`).href;
  } catch {
    return url;
  }
}

/** The session must only reach Reclinarr itself, never TMDb or an IPTV provider's logo host. */
function sessionHeadersFor(
  uri: string,
  headers: Record<string, string>,
  baseUrl: string | null | undefined,
): Record<string, string> | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(uri).origin === new URL(baseUrl).origin ? headers : undefined;
  } catch {
    return undefined;
  }
}

function useSessionAuth(): { headers: Record<string, string>; sessionId: string | null } | null {
  const [auth, setAuth] = useState<{ headers: Record<string, string>; sessionId: string | null } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    const client = tryGetClient();
    if (!client) {
      setAuth({ sessionId: null, headers: {} });
      return;
    }
    void client
      .sessionHeaders()
      .then((next) => {
        if (cancelled) return;
        const session = next[SESSION_HEADER] ?? null;
        setAuth({
          sessionId: session,
          headers: session ? { [SESSION_HEADER]: session } : {},
        });
      })
      .catch(() => {
        if (!cancelled) setAuth({ sessionId: null, headers: {} });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return auth;
}

export function Artwork({
  url,
  style,
  resizeMode = "cover",
  maxWidth,
  onError,
}: {
  url?: string | null;
  style: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  maxWidth?: number;
  onError?: () => void;
}) {
  const startedAt = useRef(typeof performance !== "undefined" ? performance.now() : Date.now());
  const sampled = useRef(Math.random() < 0.1);
  const collectMetrics = useRef(tryGetClient()?.analyticsActive() ?? false);
  const auth = useSessionAuth();
  const uri = artworkUri(url, maxWidth, auth?.sessionId);
  if (!uri || !auth) return null;
  return (
    <Image
      source={{ uri, headers: sessionHeadersFor(uri, auth.headers, tryGetClient()?.baseUrl) }}
      style={style}
      resizeMode={resizeMode}
      resizeMethod="resize"
      onLoad={() => {
        if (sampled.current && collectMetrics.current) {
          const now = typeof performance !== "undefined" ? performance.now() : Date.now();
          trackTelemetry("client.artwork_result", {
            duration_ms: Math.round(now - startedAt.current),
            outcome: "success",
          });
        }
      }}
      onError={() => {
        if (sampled.current && collectMetrics.current) {
          const now = typeof performance !== "undefined" ? performance.now() : Date.now();
          trackTelemetry("client.artwork_result", {
            duration_ms: Math.round(now - startedAt.current),
            outcome: "failure",
          });
        }
        onError?.();
      }}
    />
  );
}
