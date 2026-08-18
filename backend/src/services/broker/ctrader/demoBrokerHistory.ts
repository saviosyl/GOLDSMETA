/**
 * DEMO-only authoritative historical order/deal lookups for Gold Hunter
 * entry PENDING_RECONCILIATION. Never places orders. Never guesses.
 *
 * Correlation key: exact clientOrderId (ProtoOAOrder.clientOrderId).
 */
import { loadCTraderConfig } from "./config";
import {
  getConnection,
  loadTokenEncryptionSecret,
  persistRotatedTokensAtomic
} from "./connectionStore";
import { isCTraderLiveEnabled } from "./flags";
import { refreshAccessToken } from "./oauth";
import {
  aggregateClosingDeals,
  createOpenApiClient,
  findHistoricalOrderByClientOrderId,
  type BrokerClosedDeal,
  type BrokerDealEvidence,
  type BrokerHistoricalOrder
} from "./openApiClient";
import { decryptTokenPayload, encryptTokenPayload } from "./tokenCrypto";

export type BrokerHistoryReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; errorCode: string };

export type DemoBrokerHistoryHooks = {
  fetchOrderList?: (args: {
    ownerUid: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }) => Promise<BrokerHistoryReadResult<BrokerHistoricalOrder[]>>;
  fetchDealEvidence?: (args: {
    ownerUid: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }) => Promise<BrokerHistoryReadResult<BrokerDealEvidence[]>>;
  fetchClosingDealsForPosition?: (args: {
    ownerUid: string;
    positionId: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }) => Promise<BrokerHistoryReadResult<BrokerClosedDeal | null>>;
};

let hooks: DemoBrokerHistoryHooks = {};

export function setDemoBrokerHistoryHooksForTests(
  h: DemoBrokerHistoryHooks
): void {
  hooks = h;
}

export function resetDemoBrokerHistoryHooksForTests(): void {
  hooks = {};
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
    throw new Error("LIVE_ACCOUNT_HISTORY_DENIED");
  }
  if (!connection.selectedAccountId) {
    throw new Error("NO_ACCOUNT");
  }
  return connection.selectedAccountId;
}

/** Bounded window around Gold Hunter orderTs for ProtoOAOrderListReq. */
export function goldHunterEntryHistoryQueryWindow(args: {
  orderTs: string | null | undefined;
  nowMs?: number;
  lookbackPadMs?: number;
}): { fromTimestampMs: number; toTimestampMs: number } {
  const nowMs = args.nowMs ?? Date.now();
  const pad = args.lookbackPadMs ?? 5 * 60_000;
  const orderMs = args.orderTs ? Date.parse(args.orderTs) : NaN;
  const fromTimestampMs = Number.isFinite(orderMs)
    ? Math.max(0, orderMs - pad)
    : Math.max(0, nowMs - 7 * 86_400_000);
  return { fromTimestampMs, toTimestampMs: nowMs };
}

export async function fetchDemoHistoricalOrders(args: {
  ownerUid: string;
  fromTimestampMs: number;
  toTimestampMs: number;
}): Promise<BrokerHistoryReadResult<BrokerHistoricalOrder[]>> {
  if (hooks.fetchOrderList) {
    return hooks.fetchOrderList(args);
  }
  try {
    const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
    const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
    if (!clientId || !clientSecret) {
      return { ok: false, errorCode: "CTRADER_CLIENT_CONFIG_MISSING" };
    }
    const { accessToken, connection } = await ensureFreshAccessToken(
      args.ownerUid
    );
    const accountId = assertDemoAccount(connection);
    const client = createOpenApiClient();
    if (!client.fetchDemoOrderList) {
      return { ok: false, errorCode: "ORDER_LIST_UNSUPPORTED" };
    }
    const orders = await client.fetchDemoOrderList({
      accessToken,
      clientId,
      clientSecret,
      ctidTraderAccountId: accountId,
      fromTimestampMs: args.fromTimestampMs,
      toTimestampMs: args.toTimestampMs
    });
    return { ok: true, value: Array.isArray(orders) ? orders : [] };
  } catch (err) {
    return {
      ok: false,
      errorCode: err instanceof Error ? err.message.slice(0, 80) : "ORDER_LIST_FAIL"
    };
  }
}

export async function fetchDemoHistoricalDealEvidence(args: {
  ownerUid: string;
  fromTimestampMs: number;
  toTimestampMs: number;
}): Promise<BrokerHistoryReadResult<BrokerDealEvidence[]>> {
  if (hooks.fetchDealEvidence) {
    return hooks.fetchDealEvidence(args);
  }
  try {
    const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
    const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
    if (!clientId || !clientSecret) {
      return { ok: false, errorCode: "CTRADER_CLIENT_CONFIG_MISSING" };
    }
    const { accessToken, connection } = await ensureFreshAccessToken(
      args.ownerUid
    );
    const accountId = assertDemoAccount(connection);
    const client = createOpenApiClient();
    if (!client.fetchDemoDealEvidenceList) {
      return { ok: false, errorCode: "DEAL_EVIDENCE_UNSUPPORTED" };
    }
    const deals = await client.fetchDemoDealEvidenceList({
      accessToken,
      clientId,
      clientSecret,
      ctidTraderAccountId: accountId,
      fromTimestampMs: args.fromTimestampMs,
      toTimestampMs: args.toTimestampMs
    });
    return { ok: true, value: Array.isArray(deals) ? deals : [] };
  } catch (err) {
    return {
      ok: false,
      errorCode: err instanceof Error ? err.message.slice(0, 80) : "DEAL_LIST_FAIL"
    };
  }
}

export async function fetchDemoClosingDealForPosition(args: {
  ownerUid: string;
  positionId: string;
  fromTimestampMs: number;
  toTimestampMs: number;
}): Promise<BrokerHistoryReadResult<BrokerClosedDeal | null>> {
  if (hooks.fetchClosingDealsForPosition) {
    return hooks.fetchClosingDealsForPosition(args);
  }
  try {
    const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
    const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
    if (!clientId || !clientSecret) {
      return { ok: false, errorCode: "CTRADER_CLIENT_CONFIG_MISSING" };
    }
    const { accessToken, connection } = await ensureFreshAccessToken(
      args.ownerUid
    );
    const accountId = assertDemoAccount(connection);
    const client = createOpenApiClient();
    let deals: BrokerClosedDeal[] = [];
    if (client.fetchDemoDealsByPositionId) {
      deals = await client.fetchDemoDealsByPositionId({
        accessToken,
        clientId,
        clientSecret,
        ctidTraderAccountId: accountId,
        positionId: args.positionId,
        fromTimestampMs: args.fromTimestampMs,
        toTimestampMs: args.toTimestampMs
      });
    }
    if (
      (!deals.length || aggregateClosingDeals(deals) == null) &&
      client.fetchDemoDealList
    ) {
      const listed = await client.fetchDemoDealList({
        accessToken,
        clientId,
        clientSecret,
        ctidTraderAccountId: accountId,
        fromTimestampMs: args.fromTimestampMs,
        toTimestampMs: args.toTimestampMs
      });
      deals = listed.filter(
        (d) => String(d.positionId) === String(args.positionId)
      );
    }
    return { ok: true, value: aggregateClosingDeals(deals) };
  } catch (err) {
    return {
      ok: false,
      errorCode:
        err instanceof Error ? err.message.slice(0, 80) : "CLOSE_DEAL_LIST_FAIL"
    };
  }
}

export async function lookupDemoOrderByClientOrderId(args: {
  ownerUid: string;
  clientOrderId: string;
  orderTs: string | null | undefined;
  nowMs?: number;
}): Promise<
  BrokerHistoryReadResult<{
    order: BrokerHistoricalOrder | null;
    ordersChecked: number;
  }>
> {
  const window = goldHunterEntryHistoryQueryWindow({
    orderTs: args.orderTs,
    nowMs: args.nowMs
  });
  const read = await fetchDemoHistoricalOrders({
    ownerUid: args.ownerUid,
    ...window
  });
  if (!read.ok) return read;
  const order = findHistoricalOrderByClientOrderId(
    read.value,
    args.clientOrderId
  );
  return {
    ok: true,
    value: { order, ordersChecked: read.value.length }
  };
}

export function dealsMatchingOrderOrPosition(args: {
  deals: readonly BrokerDealEvidence[];
  orderId?: string | null;
  positionId?: string | null;
  clientOrderId?: string | null;
}): BrokerDealEvidence[] {
  const orderId = args.orderId ? String(args.orderId) : null;
  const positionId = args.positionId ? String(args.positionId) : null;
  return args.deals.filter((d) => {
    if (orderId && d.orderId && d.orderId === orderId) return true;
    if (positionId && d.positionId && d.positionId === positionId) return true;
    return false;
  });
}
