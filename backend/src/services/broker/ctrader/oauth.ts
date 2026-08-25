/**
 * cTrader OAuth 2.0 helpers — state, PKCE, authorization URL builders.
 * Default connect uses scope=accounts (read-only).
 * Authorise Demo Trading uses scope=trading after explicit owner/user action.
 */

import { createHash, randomBytes } from "node:crypto";
import { loadCTraderConfig } from "./config";

export type CTraderOAuthScope = "accounts" | "trading";

export interface OAuthStateRecord {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  createdAt: string;
  expiresAt: string;
  ownerUidHash: string;
  redirectUri: string;
  /** Requested Open API scope for this consent. */
  requestedScope: CTraderOAuthScope;
}

export function hashOwnerUid(uid: string): string {
  return createHash("sha256").update(uid).digest("hex").slice(0, 16);
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOAuthState(
  ownerUid: string,
  requestedScope: CTraderOAuthScope = "accounts"
): OAuthStateRecord {
  const conf = loadCTraderConfig();
  if (!conf.redirectUri) {
    throw new Error("CTRADER_REDIRECT_URI_MISSING");
  }
  if (requestedScope !== "accounts" && requestedScope !== "trading") {
    throw new Error("CTRADER_OAUTH_SCOPE_INVALID");
  }
  const { verifier, challenge } = createPkcePair();
  const now = Date.now();
  return {
    state: randomBytes(24).toString("base64url"),
    codeVerifier: verifier,
    codeChallenge: challenge,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
    ownerUidHash: hashOwnerUid(ownerUid),
    redirectUri: conf.redirectUri,
    requestedScope
  };
}

export function validateOAuthState(args: {
  stored: OAuthStateRecord | null;
  providedState: string;
  ownerUid: string;
  now?: Date;
  /** When true, stored record was already consumed — reject replay. */
  alreadyConsumed?: boolean;
}): { ok: true } | { ok: false; code: string } {
  if (!args.stored) return { ok: false, code: "OAUTH_STATE_MISSING" };
  if (args.alreadyConsumed) return { ok: false, code: "OAUTH_STATE_REPLAY" };
  if (args.stored.state !== args.providedState) {
    return { ok: false, code: "OAUTH_STATE_MISMATCH" };
  }
  if (args.stored.ownerUidHash !== hashOwnerUid(args.ownerUid)) {
    return { ok: false, code: "OAUTH_STATE_OWNER_MISMATCH" };
  }
  const now = args.now ?? new Date();
  if (Date.parse(args.stored.expiresAt) < now.getTime()) {
    return { ok: false, code: "OAUTH_STATE_EXPIRED" };
  }
  const conf = loadCTraderConfig();
  if (!conf.redirectUri || args.stored.redirectUri !== conf.redirectUri) {
    return { ok: false, code: "OAUTH_REDIRECT_NOT_ALLOWLISTED" };
  }
  return { ok: true };
}

/** Mark state consumed — callers must persist this atomically before token exchange. */
export function consumeOAuthState(
  stored: OAuthStateRecord
): OAuthStateRecord & { consumedAt: string } {
  return { ...stored, consumedAt: new Date().toISOString() };
}

export function assertRedirectAllowlisted(redirectUri: string): void {
  const conf = loadCTraderConfig();
  if (!conf.redirectUri || redirectUri !== conf.redirectUri) {
    throw new Error("OAUTH_REDIRECT_NOT_ALLOWLISTED");
  }
}

export function buildAuthorizationUrl(args: {
  state: string;
  codeChallenge: string;
  clientId: string;
  scope?: CTraderOAuthScope;
}): string {
  const conf = loadCTraderConfig();
  if (!conf.redirectUri) {
    throw new Error("CTRADER_REDIRECT_URI_MISSING");
  }
  const scope: CTraderOAuthScope = args.scope ?? "accounts";
  if (scope !== "accounts" && scope !== "trading") {
    throw new Error("CTRADER_OAUTH_SCOPE_INVALID");
  }
  // Never accept caller-supplied redirect — server config only.
  const redirectUri = conf.redirectUri;
  const url = new URL(conf.authUrl);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  // accounts = read-only connect; trading = Authorise Demo Trading (explicit).
  url.searchParams.set("scope", scope);
  url.searchParams.set("product", "web");
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Token exchange — only called when config present and Auth HEALTHY.
 * Never logs tokens.
 */
export async function exchangeAuthorizationCode(args: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const fetchFn = args.fetchImpl ?? fetch;
  const conf = loadCTraderConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code_verifier: args.codeVerifier
  });
  const res = await fetchFn(conf.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    throw new Error(`CTRADER_TOKEN_EXCHANGE_FAILED status=${res.status}`);
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
  const refreshToken = json.refreshToken ?? json.refresh_token;
  const expiresIn = json.expiresIn ?? json.expires_in ?? 0;
  if (!accessToken || !refreshToken) {
    throw new Error("CTRADER_TOKEN_EXCHANGE_MALFORMED");
  }
  return { accessToken, refreshToken, expiresIn };
}

/**
 * Refresh-token rotation — never logs tokens.
 * Spotware may return a new refresh token; callers must persist both.
 */
export async function refreshAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const fetchFn = args.fetchImpl ?? fetch;
  const conf = loadCTraderConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    client_secret: args.clientSecret
  });
  const res = await fetchFn(conf.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    throw new Error(`CTRADER_TOKEN_REFRESH_FAILED status=${res.status}`);
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
  // Spotware may omit refresh_token when it did not rotate; keep the prior token.
  // Never accept an empty/partial replacement that would wipe a valid refresh token.
  const rotatedRefresh = json.refreshToken ?? json.refresh_token;
  const refreshToken =
    typeof rotatedRefresh === "string" && rotatedRefresh.trim().length >= 8
      ? rotatedRefresh.trim()
      : args.refreshToken;
  const expiresIn = json.expiresIn ?? json.expires_in ?? 0;
  if (
    !accessToken ||
    typeof accessToken !== "string" ||
    accessToken.trim().length < 8 ||
    !refreshToken ||
    typeof refreshToken !== "string" ||
    refreshToken.trim().length < 8
  ) {
    throw new Error("CTRADER_TOKEN_REFRESH_MALFORMED");
  }
  return {
    accessToken: accessToken.trim(),
    refreshToken: refreshToken.trim(),
    expiresIn
  };
}

/** Safe post-OAuth frontend redirect — never includes tokens. */
export function buildOAuthFrontendRedirect(args: {
  webOrigin: string;
  status: "ok" | "error";
  code?: string;
}): string {
  const base = args.webOrigin.replace(/\/$/, "");
  const url = new URL(`${base}/brokers`);
  url.searchParams.set("ctrader", args.status === "ok" ? "oauth_ok" : "oauth_error");
  if (args.code) url.searchParams.set("reason", args.code);
  return url.toString();
}
