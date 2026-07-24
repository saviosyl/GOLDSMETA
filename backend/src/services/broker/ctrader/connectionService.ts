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
import { loadOwnerAuthConfig } from "../../auth/ownerAuthConfig";

const STALE_QUOTE_MS = 15_000;

export type DiagnosticsReport = {
  credentialsConfigured: boolean;
  oauthConnected: boolean;
  demoAccountSelected: boolean;
  pepperstoneConfirmed: boolean;
  goldSymbolFound: boolean;
  liveQuoteReceived: boolean;
  spreadAvailable: boolean;
  volumeRulesAvailable: boolean;
  marginMetadataAvailable: boolean;
  marketStatusAvailable: boolean;
  tradingSafelyLocked: true;
  autoTrade: "OFF";
  environment: "DEMO";
  connection: {
    accountMasked: string | null;
    brokerName: string | null;
    currency: string | null;
    symbolName: string | null;
    lastSyncAt: string | null;
    lastQuoteAt: string | null;
    tokenRefreshHealthy: boolean | null;
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

export function assertPinnedOwner(ownerUid: string): void {
  const cfg = loadOwnerAuthConfig();
  if (!cfg.pinnedOwnerUid || cfg.pinnedOwnerUid !== ownerUid) {
    const err = new Error("CTRADER_OWNER_ONLY");
    (err as Error & { code: string }).code = "CTRADER_OWNER_ONLY";
    throw err;
  }
}

export async function startOAuthForOwner(ownerUid: string): Promise<{
  authorizationUrl: string;
  state: string;
  expiresAt: string;
  environment: "DEMO";
}> {
  assertPinnedOwner(ownerUid);
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
  const stateRec = createOAuthState(ownerUid);
  await saveOAuthState({
    ...stateRec,
    ownerUid,
    consumedAt: null
  });
  const { clientId } = clientCreds();
  const authorizationUrl = buildAuthorizationUrl({
    state: stateRec.state,
    codeChallenge: stateRec.codeChallenge,
    clientId
  });
  return {
    authorizationUrl,
    state: stateRec.state,
    expiresAt: stateRec.expiresAt,
    environment: "DEMO"
  };
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
  assertPinnedOwner(record.ownerUid);

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
  const connection: CTraderConnectionRecord = {
    ownerUid: record.ownerUid,
    environment: "DEMO",
    connectedAt: now,
    updatedAt: now,
    tokens: {
      ciphertext,
      accessExpiresAt: new Date(
        Date.now() + Math.max(60, tokens.expiresIn) * 1000
      ).toISOString(),
      refreshedAt: null
    },
    selectedAccountId: null,
    selectedAccountMasked: null,
    selectedAccountKeyHash: null,
    brokerName: null,
    brokerConfirmedPepperstone: false,
    currency: null,
    leverage: null,
    symbolId: null,
    symbolName: null,
    lastSyncAt: now,
    lastQuoteAt: null,
    lastErrorCode: null,
    disconnectedAt: null
  };
  await saveConnection(connection);

  const api = createOpenApiClient();
  const accounts = await api.listAccountsByAccessToken(tokens.accessToken);
  const demoOnly = accounts.filter((a) => !a.isLive);
  return { ownerUid: record.ownerUid, accounts: demoOnly };
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

/** Refresh when access token expires within 60s; persist rotated refresh token. */
async function ensureFreshAccessToken(
  connection: CTraderConnectionRecord,
  fetchImpl?: typeof fetch
): Promise<{ accessToken: string; connection: CTraderConnectionRecord }> {
  const expiresAt = Date.parse(connection.tokens.accessExpiresAt);
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
    const { accessToken } = decryptTokens(connection);
    return { accessToken, connection };
  }
  const { refreshToken } = decryptTokens(connection);
  const { clientId, clientSecret } = clientCreds();
  let tokens;
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
  const enc = loadTokenEncryptionSecret();
  if (!enc) {
    throw Object.assign(new Error("CTRADER_TOKEN_ENCRYPTION_KEY_MISSING"), {
      code: "CTRADER_TOKEN_ENCRYPTION_KEY_MISSING"
    });
  }
  const ciphertext = encryptTokenPayload(
    JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    }),
    enc
  );
  const now = new Date().toISOString();
  const updated: CTraderConnectionRecord = {
    ...connection,
    updatedAt: now,
    tokens: {
      ciphertext,
      accessExpiresAt: new Date(
        Date.now() + Math.max(60, tokens.expiresIn) * 1000
      ).toISOString(),
      refreshedAt: now
    },
    lastErrorCode: null,
    disconnectedAt: null
  };
  await saveConnection(updated);
  return { accessToken: tokens.accessToken, connection: updated };
}

export async function listDemoAccountsForOwner(
  ownerUid: string,
  api: CTraderOpenApiClient = createOpenApiClient()
): Promise<DiscoveredAccount[]> {
  assertPinnedOwner(ownerUid);
  const connection = await getConnection(ownerUid);
  if (!connection) {
    throw Object.assign(new Error("CTRADER_NOT_CONNECTED"), { code: "CTRADER_NOT_CONNECTED" });
  }
  const { accessToken, connection: fresh } = await ensureFreshAccessToken(connection);
  const accounts = await api.listAccountsByAccessToken(accessToken);
  void fresh;
  // Reject live accounts entirely from the selectable list
  return accounts.filter((a) => !a.isLive);
}

export async function selectDemoAccount(args: {
  ownerUid: string;
  ctidTraderAccountId: string;
  confirmPepperstone?: boolean;
  api?: CTraderOpenApiClient;
}): Promise<{ account: ReturnType<typeof toSafeBrokerAccount>; symbol: BrokerSymbol | null }> {
  assertPinnedOwner(args.ownerUid);
  const api = args.api ?? createOpenApiClient();
  const connection = await getConnection(args.ownerUid);
  if (!connection) {
    throw Object.assign(new Error("CTRADER_NOT_CONNECTED"), { code: "CTRADER_NOT_CONNECTED" });
  }
  const { accessToken, connection: freshConn } = await ensureFreshAccessToken(connection);
  const accounts = await api.listAccountsByAccessToken(accessToken);
  const match = accounts.find((a) => a.ctidTraderAccountId === args.ctidTraderAccountId);
  if (!match) {
    throw Object.assign(new Error("CTRADER_DEMO_ACCOUNT_NOT_FOUND"), {
      code: "CTRADER_DEMO_ACCOUNT_NOT_FOUND"
    });
  }
  if (match.isLive) {
    throw Object.assign(new Error("CTRADER_LIVE_ACCOUNT_REJECTED"), {
      code: "CTRADER_LIVE_ACCOUNT_REJECTED"
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
      ctidTraderAccountId: match.ctidTraderAccountId
    });
  } catch {
    symbol = null;
  }

  const now = new Date().toISOString();
  await saveConnection({
    ...freshConn,
    updatedAt: now,
    lastSyncAt: now,
    selectedAccountId: match.ctidTraderAccountId,
    selectedAccountMasked: match.accountIdMasked,
    selectedAccountKeyHash: match.accountKeyHash,
    brokerName: match.brokerNameTitle,
    brokerConfirmedPepperstone: pepperstone,
    currency: snap.currency ?? match.depositCurrency,
    leverage: snap.leverage ?? match.leverage,
    symbolId: symbol?.symbolId ?? null,
    symbolName: symbol?.symbolName ?? null,
    lastErrorCode: null,
    disconnectedAt: null
  });

  return { account: toSafeBrokerAccount(match, snap), symbol };
}

export async function readQuoteForOwner(
  ownerUid: string,
  api: CTraderOpenApiClient = createOpenApiClient()
): Promise<BrokerQuote> {
  assertPinnedOwner(ownerUid);
  const connection = await getConnection(ownerUid);
  if (!connection?.selectedAccountId || !connection.symbolId) {
    throw Object.assign(new Error("CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED"), {
      code: "CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED"
    });
  }
  const { accessToken, connection: freshConn } = await ensureFreshAccessToken(connection);
  const { clientId, clientSecret } = clientCreds();
  const quote = await api.fetchQuote({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: freshConn.selectedAccountId!,
    symbolId: freshConn.symbolId!
  });
  const ageMs = quote.timestamp ? Date.now() - Date.parse(quote.timestamp) : Infinity;
  const stale = ageMs > STALE_QUOTE_MS;
  const result: BrokerQuote = { ...quote, stale };
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
        if (match && !match.isLive) {
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
              ctidTraderAccountId: match.ctidTraderAccountId
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
                symbolId: connection.symbolId
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
    demoAccountSelected: Boolean(connection?.selectedAccountId),
    pepperstoneConfirmed: Boolean(connection?.brokerConfirmedPepperstone),
    goldSymbolFound: Boolean(connection?.symbolId || symbol),
    liveQuoteReceived: Boolean(quote && !quote.stale),
    spreadAvailable: quote?.spread != null,
    volumeRulesAvailable: volumeRules,
    marginMetadataAvailable: marginMeta,
    marketStatusAvailable: quote?.marketStatus != null,
    tradingSafelyLocked: true,
    autoTrade: "OFF",
    environment: "DEMO",
    connection: {
      accountMasked: connection?.selectedAccountMasked ?? null,
      brokerName: connection?.brokerName ?? null,
      currency: connection?.currency ?? null,
      symbolName: connection?.symbolName ?? null,
      lastSyncAt: connection?.lastSyncAt ?? null,
      lastQuoteAt: connection?.lastQuoteAt ?? null,
      tokenRefreshHealthy
    },
    quote,
    account,
    symbol,
    technical: {
      setupMissing: config.missing,
      encryptionConfigured: Boolean(loadTokenEncryptionSecret()),
      connected: oauthConnected,
      selected: Boolean(connection?.selectedAccountId)
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
  assertPinnedOwner(args.ownerUid);
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
    ctidTraderAccountId: connectionFresh.selectedAccountId!
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

  const input: PreviewInput = {
    decisionId: args.decisionId ?? `demo-preview-${Date.now()}`,
    decision: args.decision,
    confidence: args.confidence ?? 85,
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
    riskAmountEur: 20,
    maxSpread: 2,
    demonstration: false,
    eurToAccountRate: 1,
    marginPerLot: 200
  };
  const preview = buildTradePreview(input);
  return {
    preview,
    quote,
    label: "Preview only — no order will be submitted."
  };
}

export async function disconnectOwner(ownerUid: string): Promise<void> {
  assertPinnedOwner(ownerUid);
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
