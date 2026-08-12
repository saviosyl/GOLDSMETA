/**
 * Micro-specific cTrader credential boundary.
 * Prefer MICRO_CTRADER_* env vars. Does NOT import Core oauth/config.
 *
 * Full separate OAuth consent UI is documented for a later PR; V1.1 supports
 * externally provisioned view-only tokens (scope=accounts).
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

const DEFAULT_TOKEN_URL = "https://openapi.ctrader.com/apps/token";
const DEFAULT_AUTH_URL =
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
  const tokenUrl = (env.MICRO_CTRADER_TOKEN_URL ?? DEFAULT_TOKEN_URL).trim();
  const authUrl = (env.MICRO_CTRADER_AUTH_URL ?? DEFAULT_AUTH_URL).trim();
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
 * Build a Micro OAuth authorization URL for scope=accounts only.
 * Trading scope is intentionally unsupported for Micro.
 */
export function buildMicroAccountsAuthorizationUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  authUrl?: string;
}): string {
  const url = new URL(args.authUrl ?? DEFAULT_AUTH_URL);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", "accounts");
  url.searchParams.set("product", "web");
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function refreshMicroAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const fetchFn = args.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    client_secret: args.clientSecret
  });
  const res = await fetchFn(args.tokenUrl ?? DEFAULT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    throw Object.assign(new Error("MICRO_CTRADER_TOKEN_REFRESH_FAILED"), {
      code: "oauth_expired",
      status: res.status
    });
  }
  const json = (await res.json()) as {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const accessToken = json.accessToken ?? json.access_token;
  const refreshToken = json.refreshToken ?? json.refresh_token ?? args.refreshToken;
  const expiresIn = json.expiresIn ?? json.expires_in ?? 0;
  if (!accessToken) {
    throw Object.assign(new Error("MICRO_CTRADER_TOKEN_REFRESH_MALFORMED"), {
      code: "oauth_expired"
    });
  }
  return { accessToken, refreshToken, expiresIn };
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
