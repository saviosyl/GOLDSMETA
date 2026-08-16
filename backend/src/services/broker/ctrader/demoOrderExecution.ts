/**
 * Pepperstone cTrader Demo market order submission.
 * Live accounts are always rejected. Requires trading OAuth scope + Demo flag.
 */

import { randomBytes } from "crypto";
import { loadCTraderConfig } from "./config";
import {
  getConnection,
  loadTokenEncryptionSecret,
  persistRotatedTokensAtomic
} from "./connectionStore";
import { refreshAccessToken } from "./oauth";
import {
  createOpenApiClient,
  type DemoMarketOrderRequest,
  type DemoMarketOrderResult
} from "./openApiClient";
import { decryptTokenPayload, encryptTokenPayload } from "./tokenCrypto";
import { isCTraderDemoOrderSubmissionEnabled, isCTraderLiveEnabled } from "./flags";
import { lotsToOrderVolumeUnits } from "./volumeUnits";
import { denyCTraderMutation } from "./mutationGuard";
import { assertFastAutoTradeDemoOnly } from "./fastAutoTrade/demoLock";
import { isFastAutoTradeV1Enabled } from "./fastAutoTrade/config";
import { FAST_AUTOTRADE_STRATEGY_ID } from "./fastAutoTrade/types";

const SPOT_PRICE_SCALE = 100_000;

export type SubmitDemoMarketOrderArgs = {
  ownerUid: string;
  side: "BUY" | "SELL";
  lots: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  entryHint?: number | null;
  symbolId?: string | null;
  comment?: string;
  label?: string;
  /** Optional durable client order id (e.g. Gold Hunter). */
  clientOrderId?: string | null;
  /** When FAST_AUTOTRADE_V1, Live accounts are blocked even if other gates slip. */
  strategyId?: string | null;
};

function relativeProtection(args: {
  side: "BUY" | "SELL";
  entry: number | null | undefined;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): { relativeStopLoss?: number; relativeTakeProfit?: number } {
  const entry = args.entry;
  if (entry == null || !Number.isFinite(entry)) return {};
  const out: { relativeStopLoss?: number; relativeTakeProfit?: number } = {};
  if (args.stopLoss != null && Number.isFinite(args.stopLoss)) {
    const dist =
      args.side === "BUY" ? entry - args.stopLoss : args.stopLoss - entry;
    if (dist > 0) out.relativeStopLoss = Math.round(dist * SPOT_PRICE_SCALE);
  }
  if (args.takeProfit != null && Number.isFinite(args.takeProfit)) {
    const dist =
      args.side === "BUY" ? args.takeProfit - entry : entry - args.takeProfit;
    if (dist > 0) out.relativeTakeProfit = Math.round(dist * SPOT_PRICE_SCALE);
  }
  return out;
}

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
  if (!secret) throw new Error("CTRADER_TOKEN_ENCRYPTION_KEY");
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
    !Number.isFinite(expiresAt) || expiresAt < Date.now() + 60_000;
  if (stale) {
    const rotated = await refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken
    });
    const secret = loadTokenEncryptionSecret();
    if (!secret) throw new Error("CTRADER_TOKEN_ENCRYPTION_KEY");
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

/**
 * Place a Pepperstone Demo market order for the authenticated user.
 * Never accepts Live accounts.
 */
export async function submitDemoMarketOrder(
  args: SubmitDemoMarketOrderArgs
): Promise<DemoMarketOrderResult> {
  if (isCTraderLiveEnabled()) {
    denyCTraderMutation("liveOrder");
  }
  if (!isCTraderDemoOrderSubmissionEnabled()) {
    denyCTraderMutation("placeMarketOrder");
  }

  const cfg = loadCTraderConfig();
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  if (!cfg.configured || !clientId || !clientSecret) {
    throw new Error("CONFIGURATION_REQUIRED");
  }

  const { accessToken, connection } = await ensureFreshAccessToken(args.ownerUid);

  const strategyId =
    args.strategyId ??
    (isFastAutoTradeV1Enabled() ? FAST_AUTOTRADE_STRATEGY_ID : null);
  if (strategyId === FAST_AUTOTRADE_STRATEGY_ID) {
    assertFastAutoTradeDemoOnly({
      strategyId,
      accountIsLive: connection.selectedAccountIsLive,
      environment: connection.environment
    });
  }

  if (connection.selectedAccountIsLive || connection.environment === "LIVE") {
    throw new Error("CTRADER_DEMO_ONLY_LIVE_ACCOUNT_FORBIDDEN");
  }
  if (!connection.selectedAccountId) {
    throw new Error("CTRADER_ACCOUNT_NOT_SELECTED");
  }
  if (connection.oauthScope !== "trading") {
    throw new Error("CTRADER_TRADING_SCOPE_REQUIRED");
  }
  if (!connection.brokerConfirmedPepperstone) {
    throw new Error("CTRADER_PEPPERSTONE_NOT_CONFIRMED");
  }

  const symbolId = args.symbolId ?? connection.symbolId;
  if (!symbolId) {
    throw new Error("CTRADER_SYMBOL_NOT_RESOLVED");
  }

  const volume = lotsToOrderVolumeUnits(args.lots);
  if (!(volume > 0)) {
    throw new Error("CTRADER_VOLUME_LOTS_INVALID");
  }

  const protection = relativeProtection({
    side: args.side,
    entry: args.entryHint,
    stopLoss: args.stopLoss,
    takeProfit: args.takeProfit
  });

  const request: DemoMarketOrderRequest = {
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: connection.selectedAccountId,
    symbolId,
    side: args.side,
    volume,
    relativeStopLoss: protection.relativeStopLoss,
    relativeTakeProfit: protection.relativeTakeProfit,
    clientOrderId: (
      args.clientOrderId?.trim() ||
      `gm_${randomBytes(8).toString("hex")}`
    ).slice(0, 50),
    label: (args.label ?? "GoldMeta Demo").slice(0, 100),
    comment: (args.comment ?? "GoldMeta Demo AutoTrade").slice(0, 512)
  };

  const client = createOpenApiClient();
  if (!client.placeDemoMarketOrder) {
    throw new Error("CTRADER_DEMO_ORDER_TRANSPORT_UNAVAILABLE");
  }
  return client.placeDemoMarketOrder(request);
}
