/**
 * Demo-only broker position mutations (amend SL/TP, close/partial).
 * Live accounts are always rejected. Uses the same Demo submission gate.
 */

import { loadCTraderConfig } from "./config";
import {
  getConnection,
  loadTokenEncryptionSecret,
  persistRotatedTokensAtomic
} from "./connectionStore";
import { refreshAccessToken } from "./oauth";
import {
  createOpenApiClient,
  type BrokerClosedDeal,
  type BrokerOpenPosition,
  type DemoPositionMutationResult
} from "./openApiClient";
import type { BrokerSymbol } from "../domain";
import { decryptTokenPayload, encryptTokenPayload } from "./tokenCrypto";
import { isCTraderLiveEnabled } from "./flags";
import { assertDemoPositionMutationAllowed } from "./mutationGuard";
import { fetchDemoClosingDealForPosition } from "./demoBrokerHistory";

async function decryptAccessToken(ownerUid: string): Promise<{
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  tokenVersion: number;
  connection: NonNullable<Awaited<ReturnType<typeof getConnection>>>;
}> {
  const connection = await getConnection(ownerUid);
  if (!connection) throw new Error("CTRADER_NOT_CONNECTED");
  const secret = loadTokenEncryptionSecret();
  if (!secret) throw new Error("[REDACTED]_KEY");
  const payload = JSON.parse(
    decryptTokenPayload(connection.tokens.ciphertext, secret)
  ) as { accessToken?: string; refreshToken?: string };
  if (!payload.accessToken || !payload.refreshToken) {
    throw new Error("CTRADER_TOKENS_MISSING");
  }
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    accessExpiresAt: connection.tokens.accessExpiresAt,
    tokenVersion: connection.tokens.tokenVersion ?? 0,
    connection
  };
}

async function ensureFreshAccessToken(ownerUid: string): Promise<{
  accessToken: string;
  connection: NonNullable<Awaited<ReturnType<typeof getConnection>>>;
}> {
  const cfg = loadCTraderConfig();
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  if (!cfg.configured || !clientId || !clientSecret) {
    throw new Error("CONFIGURATION_REQUIRED");
  }
  let { accessToken, refreshToken, accessExpiresAt, tokenVersion, connection } =
    await decryptAccessToken(ownerUid);

  const expiresAt = Date.parse(accessExpiresAt);
  const stale =
    !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000;
  if (stale) {
    const rotated = await refreshAccessToken({
      refreshToken,
      clientId,
      clientSecret
    });
    const secret = loadTokenEncryptionSecret();
    if (!secret) throw new Error("[REDACTED]_KEY");
    const ciphertext = encryptTokenPayload(
      JSON.stringify({
        accessToken: rotated.accessToken,
        refreshToken: rotated.refreshToken ?? refreshToken
      }),
      secret
    );
    await persistRotatedTokensAtomic({
      ownerUid,
      expectedCiphertext: connection.tokens.ciphertext,
      expectedTokenVersion: tokenVersion,
      newTokens: {
        ciphertext,
        accessExpiresAt: new Date(
          Date.now() + (rotated.expiresIn ?? 3600) * 1000
        ).toISOString(),
        refreshedAt: new Date().toISOString(),
        tokenVersion: tokenVersion + 1
      }
    });
    accessToken = rotated.accessToken;
    connection = (await getConnection(ownerUid))!;
  }
  return { accessToken, connection };
}

function assertDemoAccount(
  connection: NonNullable<Awaited<ReturnType<typeof getConnection>>>
): string {
  if (isCTraderLiveEnabled()) {
    throw new Error("LIVE_EXECUTION_LOCKED");
  }
  if (connection.selectedAccountIsLive || connection.environment === "LIVE") {
    throw new Error("LIVE_ACCOUNT_MUTATION_DENIED");
  }
  if (!connection.selectedAccountId) {
    throw new Error("NO_ACCOUNT");
  }
  return connection.selectedAccountId;
}

/** Read-only reconcile — does not require Demo mutation gate. */
export async function reconcileDemoBrokerPositions(
  ownerUid: string
): Promise<BrokerOpenPosition[]> {
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  const { accessToken, connection } = await ensureFreshAccessToken(ownerUid);
  const accountId = assertDemoAccount(connection);
  const client = createOpenApiClient();
  if (!client.reconcileDemoOpenPositions) {
    throw new Error("RECONCILE_NOT_AVAILABLE");
  }
  return client.reconcileDemoOpenPositions({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: accountId
  });
}

export async function amendDemoStopLoss(args: {
  ownerUid: string;
  positionId: string;
  stopLoss: number;
  takeProfit?: number | null;
}): Promise<DemoPositionMutationResult> {
  assertDemoPositionMutationAllowed("setStopLoss");
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  const { accessToken, connection } = await ensureFreshAccessToken(args.ownerUid);
  const accountId = assertDemoAccount(connection);
  const client = createOpenApiClient();
  if (!client.amendDemoPositionSlTp) {
    throw new Error("AMEND_NOT_AVAILABLE");
  }
  return client.amendDemoPositionSlTp({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: accountId,
    positionId: args.positionId,
    stopLoss: args.stopLoss,
    takeProfit: args.takeProfit
  });
}

export async function closeDemoBrokerPosition(args: {
  ownerUid: string;
  positionId: string;
  volumeUnits: number;
}): Promise<DemoPositionMutationResult> {
  assertDemoPositionMutationAllowed("partialClose");
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  const { accessToken, connection } = await ensureFreshAccessToken(args.ownerUid);
  const accountId = assertDemoAccount(connection);
  const client = createOpenApiClient();
  if (!client.closeDemoPosition) {
    throw new Error("CLOSE_NOT_AVAILABLE");
  }
  return client.closeDemoPosition({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: accountId,
    positionId: args.positionId,
    volume: args.volumeUnits
  });
}

/** Read-only: load lot-denominated XAUUSD volume metadata for the Demo account. */
export async function loadDemoXauUsdSymbol(
  ownerUid: string
): Promise<BrokerSymbol | null> {
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  const { accessToken, connection } = await ensureFreshAccessToken(ownerUid);
  const accountId = assertDemoAccount(connection);
  const client = createOpenApiClient();
  return client.discoverXauUsd({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: accountId,
    isLive: false
  });
}

/**
 * Spotware deal-list windows reject future toTimestamp values.
 * Clamp to now and keep a bounded lookback (max 7 days).
 */
export function goldHunterCloseDealQueryWindow(args: {
  openedAt: string;
  nowMs?: number;
}): { fromTimestampMs: number; toTimestampMs: number } {
  const nowMs = args.nowMs ?? Date.now();
  const openedMs = Date.parse(args.openedAt);
  const fromTimestampMs = Number.isFinite(openedMs)
    ? Math.max(0, openedMs - 60_000)
    : nowMs - 7 * 86_400_000;
  // Never send a future toTimestamp — Spotware rejects it.
  const toTimestampMs = nowMs;
  return { fromTimestampMs, toTimestampMs };
}

/**
 * Query broker closing deals for a position. Returns null when unavailable
 * (caller must mark CLOSE_RECONCILIATION_PENDING — never invent P/L = 0).
 *
 * FINAL settlement requires exhaustive by-position history. A truncated
 * first page (hasMore=true) must never settle CLOSED from a partial aggregate.
 */
export async function fetchConfirmedCloseForPosition(args: {
  ownerUid: string;
  positionId: string;
  openedAt: string;
}): Promise<BrokerClosedDeal | null> {
  const { fromTimestampMs, toTimestampMs } = goldHunterCloseDealQueryWindow({
    openedAt: args.openedAt
  });
  const result = await fetchDemoClosingDealForPosition({
    ownerUid: args.ownerUid,
    positionId: String(args.positionId),
    fromTimestampMs,
    toTimestampMs
  });
  if (!result.ok) return null;
  // Incomplete / truncated history → pending — never partial CLOSED.
  if (!result.value.complete) return null;
  return result.value.deal;
}
