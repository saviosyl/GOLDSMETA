/**
 * Orchestrates cTrader Demo read-only connection lifecycle.
 * AutoTrade OFF. No order submission.
 */

import { loadCTraderConfig } from "./config";
import {
  consumeOAuthStateAtomic,
  disconnectConnection,
  getConnection,
  loadTokenEncryptionSecret,
  persistRotatedTokensAtomic,
  saveConnection,
  saveOAuthState,
  type CTraderConnectionRecord
} from "./connectionStore";
import {
  buildAuthorizationUrl,
  createOAuthState,
  exchangeAuthorizationCode,
  hashOwnerUid,
  refreshAccessToken
} from "./oauth";
import {
  createOpenApiClient,
  isPepperstoneBrokerName,
  toSafeBrokerAccount,
  type CTraderOpenApiClient,
  type DiscoveredAccount
} from "./openApiClient";
import { decryptTokenPayload, encryptTokenPayload, maskAccountId } from "./tokenCrypto";
import { buildTradePreview, type PreviewInput } from "./preview";
import type { BrokerQuote, BrokerSymbol, TradePreview } from "../domain";
import { getUserAutoTradeSettings } from "./userAutoTradeSettings";
import {
  buildAuthoritativeQuote,
  loadLiveQuoteThresholds
} from "./liveQuote";
import { nextQuoteSequence, saveAuthoritativeQuote } from "./quoteStore";

/**
 * AutoTrade execution uses the LIVE display threshold so DELAYED prices
 * are never treated as eligible for live order submission.
 */
function executionStaleMaxAgeMs(): number {
  return loadLiveQuoteThresholds().liveMaxAgeMs;
}

/** Serialize refresh-token rotations per user connection (in-process). */
const refreshLocks = new Map<string, Promise<unknown>>();

async function withConnectionRefreshLock<T>(
  ownerUid: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = refreshLocks.get(ownerUid) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => undefined).then(() => gate);
  refreshLocks.set(ownerUid, chained);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (refreshLocks.get(ownerUid) === chained) {
      refreshLocks.delete(ownerUid);
    }
  }
}

export type DiagnosticsReport = {
  credentialsConfigured: boolean;
  oauthConnected: boolean;
  demoAccountSelected: boolean;
  accountSelected: boolean;
  selectedAccountIsLive: boolean;
  pepperstoneConfirmed: boolean;
  goldSymbolFound: boolean;
  liveQuoteReceived: boolean;
  spreadAvailable: boolean;
  volumeRulesAvailable: boolean;
  /** True only when freeMargin or usedMargin was returned by Open API — never invented. */
  marginMetadataAvailable: boolean;
  /** UNKNOWN until freeMargin is present from Open API. */
  marginEligibility: "OK" | "UNKNOWN" | "INSUFFICIENT";
  marketStatusAvailable: boolean;
  tradingSafelyLocked: true;
  autoTrade: "OFF";
  environment: "DEMO" | "LIVE";
  orderSubmissionEnabled: false;
  connection: {
    accountMasked: string | null;
    brokerName: string | null;
    currency: string | null;
    symbolName: string | null;
    lastSyncAt: string | null;
    lastQuoteAt: string | null;
    tokenRefreshHealthy: boolean | null;
    oauthScope?: "accounts" | "trading" | null;
    tradingScopeGrantedAt?: string | null;
    oauthScopeVersion?: string | null;
  };
  quote: BrokerQuote | null;
  account: ReturnType<typeof toSafeBrokerAccount> | null;
  symbol: BrokerSymbol | null;
  technical?: Record<string, unknown>;
};

function clientCreds(source = process.env) {
  return {
    clientId: (source.CTRADER_CLIENT_ID ?? "").trim(),
    clientSecret: (source.CTRADER_CLIENT_SECRET ?? "").trim()
  };
}

/**
 * Per-user broker isolation — routes pass the authenticated UID only.
 * Tokens/accounts are always loaded from users/{uid}/… — never from another UID.
 */
export function assertBrokerUser(uid: string): void {
  if (!uid || typeof uid !== "string" || uid.trim().length < 8) {
    const err = new Error("UNAUTHENTICATED");
    (err as Error & { code: string }).code = "UNAUTHENTICATED";
    throw err;
  }
}

/** @deprecated Alias — product no longer pins AutoTrade to a single owner UID. */
export function assertPinnedOwner(ownerUid: string): void {
  assertBrokerUser(ownerUid);
}

export async function startOAuthForOwner(
  ownerUid: string,
  opts?: { scope?: "accounts" | "trading"; purpose?: string }
): Promise<{
  authorizationUrl: string;
  state: string;
  expiresAt: string;
  environment: "DEMO";
  scope: "accounts" | "trading";
  purpose: string;
}> {
  assertBrokerUser(ownerUid);
  const config = loadCTraderConfig();
  if (!config.configured) {
    const err = new Error("CTRADER_SETUP_REQUIRED");
    (err as Error & { code: string }).code = "CTRADER_SETUP_REQUIRED";
    throw err;
  }
  const enc = loadTokenEncryptionSecret();
  if (!enc) {
    const err = new Error("CTRADER_TOKEN_ENCRYPTION_KEY_MISSING");
    (err as Error & { code: string }).code = "CTRADER_TOKEN_ENCRYPTION_KEY_MISSING";
    throw err;
  }
  const scope = opts?.scope ?? "accounts";
  const purpose =
    opts?.purpose ??
    (scope === "trading" ? "authorise_demo_trading" : "connect_accounts");
  const stateRec = createOAuthState(ownerUid, scope);
  await saveOAuthState({
    ...stateRec,
    ownerUid,
    consumedAt: null
  });
  const { clientId } = clientCreds();
  const authorizationUrl = buildAuthorizationUrl({
    state: stateRec.state,
    codeChallenge: stateRec.codeChallenge,
    clientId,
    scope
  });
  return {
    authorizationUrl,
    state: stateRec.state,
    expiresAt: stateRec.expiresAt,
    environment: "DEMO",
    scope,
    purpose
  };
}

/** Explicit trading-scope OAuth for Demo trading authorisation. */
export async function startDemoTradingOAuth(ownerUid: string) {
  return startOAuthForOwner(ownerUid, {
    scope: "trading",
    purpose: "authorise_demo_trading"
  });
}

export async function completeOAuthCallback(args: {
  code: string;
  state: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ownerUid: string; accounts: DiscoveredAccount[] }> {
  const consumed = await consumeOAuthStateAtomic(args.state);
  if (!consumed.ok) {
    const err = new Error(consumed.code);
    (err as Error & { code: string }).code = consumed.code;
    throw err;
  }
  const record = consumed.record;
  assertBrokerUser(record.ownerUid);

  if (record.ownerUidHash !== hashOwnerUid(record.ownerUid)) {
    const err = new Error("OAUTH_STATE_OWNER_MISMATCH");
    (err as Error & { code: string }).code = "OAUTH_STATE_OWNER_MISMATCH";
    throw err;
  }
  const config = loadCTraderConfig();
  if (!config.redirectUri || record.redirectUri !== config.redirectUri) {
    const err = new Error("OAUTH_REDIRECT_NOT_ALLOWLISTED");
    (err as Error & { code: string }).code = "OAUTH_REDIRECT_NOT_ALLOWLISTED";
    throw err;
  }

  const { clientId, clientSecret } = clientCreds();
  const tokens = await exchangeAuthorizationCode({
    code: args.code,
    redirectUri: record.redirectUri,
    codeVerifier: record.codeVerifier,
    clientId,
    clientSecret,
    fetchImpl: args.fetchImpl
  });

  const enc = loadTokenEncryptionSecret();
  if (!enc) {
    const err = new Error("CTRADER_TOKEN_ENCRYPTION_KEY_MISSING");
    (err as Error & { code: string }).code = "CTRADER_TOKEN_ENCRYPTION_KEY_MISSING";
    throw err;
  }

  const ciphertext = encryptTokenPayload(
    JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    }),
    enc
  );
  const now = new Date().toISOString();
  const requestedScope =
    record.requestedScope === "trading" ? "trading" : "accounts";
  const prior = await getConnection(record.ownerUid);
  const connection: CTraderConnectionRecord = {
    ownerUid: record.ownerUid,
    environment: prior?.environment === "LIVE" ? "LIVE" : "DEMO",
    connectedAt: prior?.connectedAt ?? now,
    updatedAt: now,
    tokens: {
      ciphertext,
      accessExpiresAt: new Date(
        Date.now() + Math.max(60, tokens.expiresIn) * 1000
      ).toISOString(),
      refreshedAt: null,
      tokenVersion: (prior?.tokens.tokenVersion ?? 0) + 1
    },
    // Preserve prior Demo selection across re-auth; never inherit a Live selection
    // when this consent is for Demo trading authorisation.
    selectedAccountId:
      requestedScope === "trading" && prior?.selectedAccountIsLive
        ? null
        : prior?.selectedAccountId ?? null,
    selectedAccountMasked:
      requestedScope === "trading" && prior?.selectedAccountIsLive
        ? null
        : prior?.selectedAccountMasked ?? null,
    selectedAccountKeyHash:
      requestedScope === "trading" && prior?.selectedAccountIsLive
        ? null
        : prior?.selectedAccountKeyHash ?? null,
    selectedAccountIsLive:
      requestedScope === "trading" ? false : Boolean(prior?.selectedAccountIsLive),
    brokerName: prior?.brokerName ?? null,
    brokerConfirmedPepperstone: prior?.brokerConfirmedPepperstone ?? false,
    currency: prior?.currency ?? null,
    leverage: prior?.leverage ?? null,
    balance: prior?.balance ?? null,
    symbolId: prior?.symbolId ?? null,
    symbolName: prior?.symbolName ?? null,
    symbolDigits: prior?.symbolDigits ?? null,
    symbolPipPosition: prior?.symbolPipPosition ?? null,
    lastSyncAt: now,
    lastQuoteAt: prior?.lastQuoteAt ?? null,
    lastErrorCode: null,
    disconnectedAt: null,
    liveSelectionConfirmedAt:
      requestedScope === "trading" ? null : prior?.liveSelectionConfirmedAt ?? null,
    oauthScope: requestedScope,
    tradingScopeGrantedAt:
      requestedScope === "trading" ? now : prior?.tradingScopeGrantedAt ?? null,
    oauthScopeVersion:
      requestedScope === "trading"
        ? `trading-v1-${now}`
        : prior?.oauthScopeVersion ?? `accounts-v1-${now}`
  };
  await saveConnection(connection);

  const api = createOpenApiClient();
  const accounts = await api.listAccountsByAccessToken(tokens.accessToken);
  // Return Demo + Live — UI separates modes; Live needs explicit confirmation to select.
  return { ownerUid: record.ownerUid, accounts };
}

function decryptTokens(connection: CTraderConnectionRecord): {
  accessToken: string;
  refreshToken: string;
} {
  const enc = loadTokenEncryptionSecret();
  if (!enc) throw Object.assign(new Error("CTRADER_TOKEN_ENCRYPTION_KEY_MISSING"), { code: "CTRADER_TOKEN_ENCRYPTION_KEY_MISSING" });
  const plain = decryptTokenPayload(connection.tokens.ciphertext, enc);
  const parsed = JSON.parse(plain) as { accessToken?: string; refreshToken?: string };
  if (!parsed.accessToken || !parsed.refreshToken) {
    throw Object.assign(new Error("CTRADER_TOKEN_PAYLOAD_INVALID"), { code: "CTRADER_TOKEN_PAYLOAD_INVALID" });
  }
  return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
}

/**
 * Refresh when access token expires within 60s (or when force=true).
 *
 * Failure-mode guards:
 * - never use rotated tokens until encrypted persistence is confirmed
 * - never overwrite a valid record with a partial refresh response
 * - compare-and-set on ciphertext + tokenVersion
 * - serialize concurrent refresh attempts per ownerUid
 * - on version conflict, adopt the already-persisted winner (no stale write)
 */
export async function ensureFreshAccessToken(
  connection: CTraderConnectionRecord,
  fetchImpl?: typeof fetch,
  opts?: { force?: boolean }
): Promise<{ accessToken: string; connection: CTraderConnectionRecord }> {
  const expiresAt = Date.parse(connection.tokens.accessExpiresAt);
  if (
    !opts?.force &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + 60_000
  ) {
    const { accessToken } = decryptTokens(connection);
    return { accessToken, connection };
  }

  return withConnectionRefreshLock(connection.ownerUid, async () => {
    // Re-read under the lock — another request may have already rotated.
    const latest = (await getConnection(connection.ownerUid)) ?? connection;
    const latestExpires = Date.parse(latest.tokens.accessExpiresAt);
    if (
      !opts?.force &&
      Number.isFinite(latestExpires) &&
      latestExpires > Date.now() + 60_000
    ) {
      const { accessToken } = decryptTokens(latest);
      return { accessToken, connection: latest };
    }

    const expectedCiphertext = latest.tokens.ciphertext;
    const expectedTokenVersion = latest.tokens.tokenVersion ?? 0;
    const { refreshToken } = decryptTokens(latest);
    const { clientId, clientSecret } = clientCreds();

    let tokens: { accessToken: string; refreshToken: string; expiresIn: number };
    try {
      tokens = await refreshAccessToken({
        refreshToken,
        clientId,
        clientSecret,
        fetchImpl
      });
    } catch (e) {
      throw Object.assign(new Error("CTRADER_TOKEN_REFRESH_FAILED"), {
        code: "CTRADER_TOKEN_REFRESH_FAILED",
        cause: e
      });
    }

    if (
      !tokens.accessToken ||
      !tokens.refreshToken ||
      typeof tokens.accessToken !== "string" ||
      typeof tokens.refreshToken !== "string" ||
      tokens.accessToken.length < 8 ||
      tokens.refreshToken.length < 8
    ) {
      throw Object.assign(new Error("CTRADER_TOKEN_REFRESH_PARTIAL"), {
        code: "CTRADER_TOKEN_REFRESH_PARTIAL"
      });
    }

    const enc = loadTokenEncryptionSecret();
    if (!enc) {
      throw Object.assign(new Error("CTRADER_TOKEN_ENCRYPTION_KEY_MISSING"), {
        code: "CTRADER_TOKEN_ENCRYPTION_KEY_MISSING"
      });
    }

    const now = new Date().toISOString();
    const newCiphertext = encryptTokenPayload(
      JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      }),
      enc
    );

    const persist = await persistRotatedTokensAtomic({
      ownerUid: latest.ownerUid,
      expectedCiphertext,
      expectedTokenVersion,
      newTokens: {
        ciphertext: newCiphertext,
        accessExpiresAt: new Date(
          Date.now() + Math.max(60, tokens.expiresIn) * 1000
        ).toISOString(),
        refreshedAt: now
      }
    });

    if (persist.ok) {
      // Only after confirmed persistence may callers use the new access token.
      const confirmed = decryptTokens(persist.record);
      if (confirmed.accessToken !== tokens.accessToken) {
        throw Object.assign(new Error("CTRADER_TOKEN_PERSIST_MISMATCH"), {
          code: "CTRADER_TOKEN_PERSIST_MISMATCH"
        });
      }
      return { accessToken: confirmed.accessToken, connection: persist.record };
    }

    if (persist.code === "CTRADER_TOKEN_VERSION_CONFLICT" && persist.record) {
      // Another refresh won — use the persisted winner; never write stale tokens.
      const { accessToken } = decryptTokens(persist.record);
      return { accessToken, connection: persist.record };
    }

    throw Object.assign(new Error("CTRADER_TOKEN_REFRESH_FAILED"), {
      code: "CTRADER_TOKEN_REFRESH_FAILED",
      detail: persist.code
    });
  });
}

/** List all authorised cTrader accounts for this user (Demo + Live). */
export async function listAuthorisedAccountsForUser(
  ownerUid: string,
  api: CTraderOpenApiClient = createOpenApiClient()
): Promise<DiscoveredAccount[]> {
  assertBrokerUser(ownerUid);
  const connection = await getConnection(ownerUid);
  if (!connection) {
    throw Object.assign(new Error("CTRADER_NOT_CONNECTED"), { code: "CTRADER_NOT_CONNECTED" });
  }
  const fresh = await ensureFreshAccessToken(connection);
  try {
    return await api.listAccountsByAccessToken(fresh.accessToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const authLikely =
      /CTRADER_ACCOUNT_LIST_FAILED status=(401|403|400)/.test(msg) ||
      /ACCESS_DENIED|UNAUTHORIZED|INVALID_TOKEN/i.test(msg);
    if (!authLikely) throw e;
    // Access token may be revoked while expiry metadata still looks valid.
    // Force one serialized refresh+persist cycle, then retry once.
    const forced = await ensureFreshAccessToken(fresh.connection, undefined, {
      force: true
    });
    return api.listAccountsByAccessToken(forced.accessToken);
  }
}

/** @deprecated Prefer listAuthorisedAccountsForUser — Demo-only filter removed from product. */
export async function listDemoAccountsForOwner(
  ownerUid: string,
  api: CTraderOpenApiClient = createOpenApiClient()
): Promise<DiscoveredAccount[]> {
  const all = await listAuthorisedAccountsForUser(ownerUid, api);
  return all.filter((a) => !a.isLive);
}

export async function selectBrokerAccountForUser(args: {
  ownerUid: string;
  ctidTraderAccountId: string;
  confirmPepperstone?: boolean;
  /** Required when selecting a Live account — never inherited from Demo. */
  confirmLiveSelection?: boolean;
  api?: CTraderOpenApiClient;
}): Promise<{ account: ReturnType<typeof toSafeBrokerAccount>; symbol: BrokerSymbol | null }> {
  assertBrokerUser(args.ownerUid);
  const api = args.api ?? createOpenApiClient();
  const connection = await getConnection(args.ownerUid);
  if (!connection) {
    throw Object.assign(new Error("CTRADER_NOT_CONNECTED"), { code: "CTRADER_NOT_CONNECTED" });
  }
  const { accessToken, connection: freshConn } = await ensureFreshAccessToken(connection);
  const accounts = await api.listAccountsByAccessToken(accessToken);
  // Never accept an account ID that was not returned for this user's OAuth tokens.
  const match = accounts.find((a) => a.ctidTraderAccountId === args.ctidTraderAccountId);
  if (!match) {
    throw Object.assign(new Error("CTRADER_ACCOUNT_NOT_AUTHORISED"), {
      code: "CTRADER_ACCOUNT_NOT_AUTHORISED"
    });
  }
  if (match.isLive && !args.confirmLiveSelection) {
    throw Object.assign(new Error("CTRADER_LIVE_SELECTION_CONFIRMATION_REQUIRED"), {
      code: "CTRADER_LIVE_SELECTION_CONFIRMATION_REQUIRED"
    });
  }
  // Demo trading authorisation path must never select a Live account.
  if (match.isLive && freshConn.oauthScope === "trading") {
    throw Object.assign(new Error("CTRADER_DEMO_TRADING_LIVE_ACCOUNT_FORBIDDEN"), {
      code: "CTRADER_DEMO_TRADING_LIVE_ACCOUNT_FORBIDDEN"
    });
  }

  const { clientId, clientSecret } = clientCreds();
  const snap = await api.fetchAccountSnapshot({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: match.ctidTraderAccountId
  });

  const pepperstone =
    isPepperstoneBrokerName(match.brokerNameTitle) ||
    Boolean(args.confirmPepperstone);

  let symbol: BrokerSymbol | null = null;
  try {
    symbol = await api.discoverXauUsd({
      accessToken,
      clientId,
      clientSecret,
      ctidTraderAccountId: match.ctidTraderAccountId,
      isLive: match.isLive
    });
  } catch {
    symbol = null;
  }

  const now = new Date().toISOString();
  const environment = match.isLive ? "LIVE" : "DEMO";
  await saveConnection({
    ...freshConn,
    environment,
    updatedAt: now,
    lastSyncAt: now,
    selectedAccountId: match.ctidTraderAccountId,
    selectedAccountMasked: match.accountIdMasked,
    selectedAccountKeyHash: match.accountKeyHash,
    selectedAccountIsLive: match.isLive,
    brokerName: match.brokerNameTitle,
    brokerConfirmedPepperstone: pepperstone,
    currency: snap.currency ?? match.depositCurrency,
    leverage: snap.leverage ?? match.leverage,
    balance: snap.balance,
    symbolId: symbol?.symbolId ?? null,
    symbolName: symbol?.symbolName ?? null,
    symbolDigits: symbol?.digits ?? null,
    symbolPipPosition: symbol?.pipPosition ?? null,
    lastErrorCode: null,
    disconnectedAt: null,
    liveSelectionConfirmedAt: match.isLive ? now : null
  });

  return { account: toSafeBrokerAccount(match, snap), symbol };
}

/** @deprecated Prefer selectBrokerAccountForUser. */
export async function selectDemoAccount(args: {
  ownerUid: string;
  ctidTraderAccountId: string;
  confirmPepperstone?: boolean;
  api?: CTraderOpenApiClient;
}): Promise<{ account: ReturnType<typeof toSafeBrokerAccount>; symbol: BrokerSymbol | null }> {
  return selectBrokerAccountForUser({
    ...args,
    confirmLiveSelection: false
  });
}

export async function readQuoteForOwner(
  ownerUid: string,
  api: CTraderOpenApiClient = createOpenApiClient()
): Promise<BrokerQuote> {
  assertBrokerUser(ownerUid);
  const connection = await getConnection(ownerUid);
  if (!connection?.selectedAccountId || !connection.symbolId) {
    throw Object.assign(new Error("CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED"), {
      code: "CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED"
    });
  }
  const { accessToken, connection: freshConn } = await ensureFreshAccessToken(connection);
  const { clientId, clientSecret } = clientCreds();
  const isLive = Boolean(freshConn.selectedAccountIsLive);
  const quote = await api.fetchQuote({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: freshConn.selectedAccountId!,
    symbolId: freshConn.symbolId!,
    isLive
  });
  const ageMs = quote.timestamp ? Date.now() - Date.parse(quote.timestamp) : Infinity;
  // When market is CLOSED, Spotware's first spot event is last session price — not a live tick.
  // Accept it for read-only diagnostics; only reject age when market is OPEN/UNKNOWN.
  const marketClosed = quote.marketStatus === "CLOSED";
  const stale = !marketClosed && ageMs > executionStaleMaxAgeMs();
  const result: BrokerQuote = { ...quote, stale };

  // Persist into the authoritative live-quote store for dashboard + AutoTrade.
  if (quote.bid != null && quote.ask != null && quote.timestamp) {
    try {
      const sequence = await nextQuoteSequence(ownerUid);
      const authoritative = buildAuthoritativeQuote({
        symbolId: freshConn.symbolId!,
        symbolName: freshConn.symbolName ?? quote.symbolName ?? "XAUUSD",
        digits: freshConn.symbolDigits ?? null,
        pipPosition: freshConn.symbolPipPosition ?? null,
        bid: quote.bid,
        ask: quote.ask,
        brokerTimestamp: quote.timestamp,
        quoteSequence: sequence,
        marketStatus: quote.marketStatus,
        environment: isLive ? "LIVE" : "DEMO",
        source: "LIVE",
        thresholds: loadLiveQuoteThresholds()
      });
      await saveAuthoritativeQuote(ownerUid, authoritative);
    } catch {
      /* store best-effort — quote response still returns */
    }
  }

  if (stale) {
    throw Object.assign(new Error("CTRADER_QUOTE_STALE"), {
      code: "CTRADER_QUOTE_STALE",
      quote: result
    });
  }
  await saveConnection({
    ...freshConn,
    lastQuoteAt: quote.timestamp,
    lastSyncAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return result;
}

export async function buildDiagnostics(
  ownerUid: string,
  api: CTraderOpenApiClient = createOpenApiClient()
): Promise<DiagnosticsReport> {
  const config = loadCTraderConfig();
  const connection = await getConnection(ownerUid);
  const oauthConnected = Boolean(connection);
  let account = null;
  let symbol: BrokerSymbol | null = null;
  let quote: BrokerQuote | null = null;
  let volumeRules = false;
  let marginMeta = false;
  let tokenRefreshHealthy: boolean | null = null;

  if (connection) {
    tokenRefreshHealthy =
      Date.parse(connection.tokens.accessExpiresAt) > Date.now() + 60_000;
    if (connection.selectedAccountId) {
      try {
        const { accessToken } = await ensureFreshAccessToken(connection).then((r) => ({
          accessToken: r.accessToken
        }));
        const accounts = await api.listAccountsByAccessToken(accessToken);
        const match = accounts.find(
          (a) => a.ctidTraderAccountId === connection.selectedAccountId
        );
        if (match) {
          const { clientId, clientSecret } = clientCreds();
          const snap = await api.fetchAccountSnapshot({
            accessToken,
            clientId,
            clientSecret,
            ctidTraderAccountId: match.ctidTraderAccountId
          });
          account = toSafeBrokerAccount(match, snap);
          marginMeta = snap.freeMargin != null || snap.usedMargin != null;
          if (connection.symbolId) {
            symbol = await api.discoverXauUsd({
              accessToken,
              clientId,
              clientSecret,
              ctidTraderAccountId: match.ctidTraderAccountId,
              isLive: match.isLive
            });
            volumeRules = Boolean(
              symbol?.minVolume != null &&
                symbol.volumeStep != null &&
                symbol.lotSize != null
            );
            try {
              quote = await api.fetchQuote({
                accessToken,
                clientId,
                clientSecret,
                ctidTraderAccountId: match.ctidTraderAccountId,
                symbolId: connection.symbolId,
                isLive: match.isLive
              });
            } catch {
              quote = null;
            }
          }
        }
      } catch {
        /* diagnostics remain partial */
      }
    }
  }

  return {
    credentialsConfigured: config.configured && Boolean(loadTokenEncryptionSecret()),
    oauthConnected,
    demoAccountSelected: Boolean(
      connection?.selectedAccountId && !connection.selectedAccountIsLive
    ),
    accountSelected: Boolean(connection?.selectedAccountId),
    selectedAccountIsLive: Boolean(connection?.selectedAccountIsLive),
    pepperstoneConfirmed: Boolean(connection?.brokerConfirmedPepperstone),
    goldSymbolFound: Boolean(connection?.symbolId || symbol),
    liveQuoteReceived: Boolean(
      quote &&
        quote.bid != null &&
        quote.ask != null &&
        (!quote.stale || quote.marketStatus === "CLOSED")
    ),
    spreadAvailable: quote?.spread != null,
    volumeRulesAvailable: volumeRules,
    marginMetadataAvailable: marginMeta,
    marginEligibility: marginMeta ? "OK" : "UNKNOWN",
    marketStatusAvailable: quote?.marketStatus != null,
    tradingSafelyLocked: true,
    autoTrade: "OFF",
    environment: connection?.environment === "LIVE" ? "LIVE" : "DEMO",
    orderSubmissionEnabled: false,
    connection: {
      accountMasked: connection?.selectedAccountMasked ?? null,
      brokerName: connection?.brokerName ?? null,
      currency: connection?.currency ?? null,
      symbolName: connection?.symbolName ?? null,
      lastSyncAt: connection?.lastSyncAt ?? null,
      lastQuoteAt: connection?.lastQuoteAt ?? null,
      tokenRefreshHealthy,
      oauthScope: connection?.oauthScope ?? "accounts",
      tradingScopeGrantedAt: connection?.tradingScopeGrantedAt ?? null,
      oauthScopeVersion: connection?.oauthScopeVersion ?? null
    },
    quote,
    account,
    symbol,
    technical: {
      setupMissing: config.missing,
      encryptionConfigured: Boolean(loadTokenEncryptionSecret()),
      connected: oauthConnected,
      selected: Boolean(connection?.selectedAccountId),
      marginNote:
        "freeMargin/usedMargin absent from ProtoOATraderRes and ProtoOAReconcileRes under scope=accounts; not invented. Margin eligibility UNKNOWN until Open API returns freeMargin."
    }
  };
}

export async function buildLiveDemoPreview(args: {
  ownerUid: string;
  decision: string;
  decisionId?: string;
  confidence?: number;
  stopLoss?: number;
  takeProfits?: number[];
  candleConfirmed?: boolean;
  api?: CTraderOpenApiClient;
}): Promise<{ preview: TradePreview; quote: BrokerQuote; label: string }> {
  assertBrokerUser(args.ownerUid);
  const connection = await getConnection(args.ownerUid);
  if (!connection?.selectedAccountId || !connection.symbolId) {
    throw Object.assign(new Error("CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED"), {
      code: "CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED"
    });
  }
  const api = args.api ?? createOpenApiClient();
  const quote = await readQuoteForOwner(args.ownerUid, api);
  const connectionFresh = (await getConnection(args.ownerUid))!;
  const { accessToken } = decryptTokens(connectionFresh);
  const { clientId, clientSecret } = clientCreds();
  const symbol = await api.discoverXauUsd({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: connectionFresh.selectedAccountId!,
    isLive: Boolean(connectionFresh.selectedAccountIsLive)
  });
  if (!symbol) {
    throw Object.assign(new Error("CTRADER_SYMBOL_NOT_FOUND"), {
      code: "CTRADER_SYMBOL_NOT_FOUND"
    });
  }
  const snap = await api.fetchAccountSnapshot({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: connectionFresh.selectedAccountId!
  });

  const envKey = connectionFresh.selectedAccountIsLive ? "live" : "demo";
  const settings = await getUserAutoTradeSettings(args.ownerUid, envKey);
  const input: PreviewInput = {
    decisionId: args.decisionId ?? `demo-preview-${Date.now()}`,
    decision: args.decision,
    confidence: args.confidence ?? settings.minConfidence,
    generatedAt: new Date().toISOString(),
    candleConfirmed: args.candleConfirmed !== false,
    stopLoss: args.stopLoss ?? (quote.bid != null ? quote.bid - 10 : null),
    takeProfits: args.takeProfits ?? (quote.ask != null ? [quote.ask + 15] : []),
    symbol,
    quote,
    position: null,
    pendingOrdersCount: 0,
    equity: snap.equity,
    freeMargin: snap.freeMargin,
    accountCurrency: snap.currency ?? connectionFresh.currency ?? "EUR",
    riskAmountEur: settings.fixedRiskAmount,
    maxSpread: settings.maxSpread,
    demonstration: false,
    eurToAccountRate: 1,
    marginPerLot: 200,
    sizingMode: settings.sizingMode,
    manualLotSize: settings.manualLotSize,
    minConfidence: settings.minConfidence,
    maxQuoteAgeSeconds: settings.maxQuoteAgeSeconds,
    maxOpenPositions: settings.maxOpenPositions,
    maxTradesPerDay: settings.maxTradesPerDay,
    confirmationCandleRequired: settings.confirmationCandleRequired
  };
  const preview = buildTradePreview(input);
  return {
    preview,
    quote,
    label: "Preview only — no order will be submitted."
  };
}

export async function disconnectOwner(ownerUid: string): Promise<void> {
  assertBrokerUser(ownerUid);
  await disconnectConnection(ownerUid);
}

export function redactForLogs(value: unknown): unknown {
  if (typeof value === "string") {
    if (/eyJ|access_token|refresh_token|Bearer\s/i.test(value)) return "[REDACTED]";
    if (value.length > 24 && /^[A-Za-z0-9_-]+$/.test(value)) {
      return maskAccountId(value);
    }
  }
  return value;
}
