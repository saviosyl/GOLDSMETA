/**
 * Micro-specific cTrader credential boundary.
 * Prefer MICRO_CTRADER_* env vars. Does NOT import Core oauth/config.
 *
 * OAuth scope is always accounts (read-only). Trading scope is unsupported.
 * Token HTTP follows official cTrader Open API (POST + query parameters).
 * Never log tokens / client_secret / authorization codes / full token URLs.
 */

export type MicroCTraderEnvironment = "DEMO" | "LIVE";

export type MicroCTraderCredentials = {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string | null;
  accountId: string;
  environment: MicroCTraderEnvironment;
  tokenUrl: string;
  authUrl: string;
  redirectUri: string | null;
};

export type MicroAuthLoadResult =
  | { ok: true; credentials: MicroCTraderCredentials }
  | { ok: false; reason: "oauth_missing"; missing: string[] };

export const MICRO_CTRADER_DEFAULT_TOKEN_URL =
  "https://openapi.ctrader.com/apps/token";
export const MICRO_CTRADER_DEFAULT_AUTH_URL =
  "https://id.ctrader.com/my/settings/openapi/grantingaccess/";

export function loadMicroCTraderCredentials(
  env: NodeJS.ProcessEnv = process.env
): MicroAuthLoadResult {
  const clientId = (env.MICRO_CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (env.MICRO_CTRADER_CLIENT_SECRET ?? "").trim();
  const accessToken = (env.MICRO_CTRADER_ACCESS_TOKEN ?? "").trim();
  const refreshToken = (env.MICRO_CTRADER_REFRESH_TOKEN ?? "").trim() || null;
  const accountId = (env.MICRO_CTRADER_ACCOUNT_ID ?? "").trim();
  const environmentRaw = (env.MICRO_CTRADER_ENVIRONMENT ?? "DEMO").trim().toUpperCase();
  const environment: MicroCTraderEnvironment =
    environmentRaw === "LIVE" ? "LIVE" : "DEMO";
  const tokenUrl = (env.MICRO_CTRADER_TOKEN_URL ?? MICRO_CTRADER_DEFAULT_TOKEN_URL).trim();
  const authUrl = (env.MICRO_CTRADER_AUTH_URL ?? MICRO_CTRADER_DEFAULT_AUTH_URL).trim();
  const redirectUri = (env.MICRO_CTRADER_REDIRECT_URI ?? "").trim() || null;

  const missing: string[] = [];
  if (!clientId) missing.push("MICRO_CTRADER_CLIENT_ID");
  if (!clientSecret) missing.push("MICRO_CTRADER_CLIENT_SECRET");
  if (!accessToken) missing.push("MICRO_CTRADER_ACCESS_TOKEN");
  if (!accountId) missing.push("MICRO_CTRADER_ACCOUNT_ID");
  if (missing.length) return { ok: false, reason: "oauth_missing", missing };

  return {
    ok: true,
    credentials: {
      clientId,
      clientSecret,
      accessToken,
      refreshToken,
      accountId,
      environment,
      tokenUrl,
      authUrl,
      redirectUri
    }
  };
}

/**
 * Official cTrader Open API authorization URL for Micro:
 * client_id, redirect_uri, scope=accounts, product=web
 *
 * No PKCE. No trading scope. No undocumented query parameters.
 */
export function buildMicroAccountsAuthorizationUrl(args: {
  clientId: string;
  redirectUri: string;
  authUrl?: string;
}): string {
  const url = new URL(args.authUrl ?? MICRO_CTRADER_DEFAULT_AUTH_URL);
  // Clear any inherited search params, then set only documented fields.
  url.search = "";
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", "accounts");
  url.searchParams.set("product", "web");
  return url.toString();
}

export type MicroTokenResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

function parseTokenJson(json: Record<string, unknown>): MicroTokenResult {
  const accessToken = String(
    json.accessToken ?? json.access_token ?? ""
  ).trim();
  const refreshToken = String(
    json.refreshToken ?? json.refresh_token ?? ""
  ).trim();
  const expiresIn = Number(json.expiresIn ?? json.expires_in ?? 0);
  if (!accessToken || !refreshToken) {
    throw Object.assign(new Error("MICRO_CTRADER_TOKEN_MALFORMED"), {
      code: "oauth_expired"
    });
  }
  return {
    accessToken,
    refreshToken,
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : 0
  };
}

/**
 * Official token endpoint places parameters in the query string.
 * authorization_code → GET; refresh_token → POST (per current Open API docs).
 * Never log the constructed URL (contains secrets).
 */
async function requestCTraderTokenQuery(args: {
  tokenUrl: string;
  method: "GET" | "POST";
  params: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<MicroTokenResult> {
  const fetchFn = args.fetchImpl ?? fetch;
  const url = new URL(args.tokenUrl);
  for (const [k, v] of Object.entries(args.params)) {
    url.searchParams.set(k, v);
  }
  // Intentionally do not log `url.toString()` — secrets are in the query.
  const res = await fetchFn(url.toString(), {
    method: args.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) {
    throw Object.assign(new Error("MICRO_CTRADER_TOKEN_HTTP_FAILED"), {
      code: "oauth_expired",
      status: res.status
    });
  }
  const json = (await res.json()) as Record<string, unknown>;
  return parseTokenJson(json);
}

/** Backend-only authorization-code exchange. Never expose unauthenticated. */
export async function exchangeMicroAuthorizationCode(args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<MicroTokenResult> {
  if (!args.code.trim()) {
    throw Object.assign(new Error("MICRO_CTRADER_CODE_MISSING"), {
      code: "oauth_missing"
    });
  }
  return requestCTraderTokenQuery({
    tokenUrl: args.tokenUrl ?? MICRO_CTRADER_DEFAULT_TOKEN_URL,
    method: "GET",
    fetchImpl: args.fetchImpl,
    params: {
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: args.clientId,
      client_secret: args.clientSecret
    }
  });
}

export async function refreshMicroAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<MicroTokenResult> {
  if (!args.refreshToken.trim()) {
    throw Object.assign(new Error("MICRO_CTRADER_REFRESH_MISSING"), {
      code: "oauth_missing"
    });
  }
  return requestCTraderTokenQuery({
    tokenUrl: args.tokenUrl ?? MICRO_CTRADER_DEFAULT_TOKEN_URL,
    method: "POST",
    fetchImpl: args.fetchImpl,
    params: {
      grant_type: "refresh_token",
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret
    }
  });
}

/** Safe public view — never includes tokens/secrets. */
export function publicCredentialStatus(result: MicroAuthLoadResult): {
  configured: boolean;
  environment: MicroCTraderEnvironment | null;
  accountIdConfigured: boolean;
  missing: string[];
} {
  if (!result.ok) {
    return {
      configured: false,
      environment: null,
      accountIdConfigured: false,
      missing: result.missing
    };
  }
  return {
    configured: true,
    environment: result.credentials.environment,
    accountIdConfigured: Boolean(result.credentials.accountId),
    missing: []
  };
}

/**
 * Parse authorized ctidTraderAccountId list from
 * ProtoOAGetAccountListByAccessTokenRes.
 */
export function extractAuthorizedAccountIds(res: unknown): string[] {
  const root = (res ?? {}) as Record<string, unknown>;
  const list =
    (root.ctidTraderAccount as unknown) ??
    root.ctidTraderAccountId ??
    root.account ??
    root.accounts;
  const arr = Array.isArray(list) ? list : list != null ? [list] : [];
  const ids: string[] = [];
  for (const item of arr) {
    if (typeof item === "number" || typeof item === "string") {
      const s = String(item).trim();
      if (s) ids.push(s);
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const id = o.ctidTraderAccountId ?? o.accountId ?? o.id;
      if (id != null && String(id).trim()) ids.push(String(id).trim());
    }
  }
  return [...new Set(ids)];
}

export function assertConfiguredAccountAuthorized(args: {
  configuredAccountId: string;
  authorizedAccountIds: string[];
}): { authorizedAccountCount: number; configuredAccountAuthorized: true } {
  const configured = String(args.configuredAccountId).trim();
  if (!configured) {
    throw Object.assign(new Error("MICRO_ACCOUNT_ID_MISSING"), {
      code: "account_not_authorized"
    });
  }
  if (!args.authorizedAccountIds.length) {
    throw Object.assign(new Error("MICRO_ACCOUNT_LIST_EMPTY"), {
      code: "account_not_authorized"
    });
  }
  const ok = args.authorizedAccountIds.some((id) => id === configured);
  if (!ok) {
    throw Object.assign(new Error("MICRO_ACCOUNT_NOT_AUTHORIZED"), {
      code: "account_not_authorized"
    });
  }
  return {
    authorizedAccountCount: args.authorizedAccountIds.length,
    configuredAccountAuthorized: true
  };
}
