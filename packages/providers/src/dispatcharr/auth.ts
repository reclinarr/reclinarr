export type DispatcharrAuth =
  | { type: "apiKey"; apiKey: string }
  | { type: "credentials"; username: string; password: string };

export interface CloudflareAccessServiceToken {
  clientId: string;
  clientSecret: string;
}

export function authHeaders(auth: DispatcharrAuth, accessToken?: string): Record<string, string> {
  if (auth.type === "apiKey") {
    return { Authorization: `ApiKey ${auth.apiKey}` };
  }
  if (accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
  }
  return {};
}

export function cloudflareAccessHeaders(
  token?: CloudflareAccessServiceToken,
): Record<string, string> {
  if (!token?.clientId || !token?.clientSecret) return {};
  return {
    "CF-Access-Client-Id": token.clientId,
    "CF-Access-Client-Secret": token.clientSecret,
  };
}
