/**
 * DEMO-only authoritative historical order/deal lookups for Gold Hunter
 * entry PENDING_RECONCILIATION. Never places orders. Never guesses.
 *
 * Correlation key: exact clientOrderId (ProtoOAOrder.clientOrderId).
 *
 * Completeness: ProtoOAOrderListRes / ProtoOADealListRes.hasMore means a
 * page is truncated. Terminal NEWORDER_RECONCILED_NOT_FOUND requires
 * exhaustive history (hasMore proven false across the full orderTs window).
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
  clampOrderTsAnchoredHistoryWindow,
  createOpenApiClient,
  findHistoricalOrderByClientOrderId,
  type BrokerClosedDeal,
  type BrokerDealEvidence,
  type BrokerHistoricalOrder,
  type BrokerHistoryPage
} from "./openApiClient";
import { decryptTokenPayload, encryptTokenPayload } from "./tokenCrypto";

export type BrokerHistoryReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; errorCode: string };

/** Exhaustive history result — complete=false must not count as empty proof. */
export type ExhaustiveHistoryResult<T> =
  | {
      ok: true;
      complete: true;
      items: T[];
      pages: number;
    }
  | {
      ok: true;
      complete: false;
      items: T[];
      pages: number;
      reason: string;
    }
  | { ok: false; errorCode: string };

export type DemoBrokerHistoryHooks = {
  /** Page-level order list (supports hasMore pagination tests). */
  fetchOrderListPage?: (args: {
    ownerUid: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }) => Promise<BrokerHistoryReadResult<BrokerHistoryPage<BrokerHistoricalOrder>>>;
  /** Page-level deal evidence list. */
  fetchDealEvidencePage?: (args: {
    ownerUid: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }) => Promise<BrokerHistoryReadResult<BrokerHistoryPage<BrokerDealEvidence>>>;
  /** Page-level DealListByPositionId (hasMore aware). */
  fetchDealsByPositionIdPage?: (args: {
    ownerUid: string;
    positionId: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }) => Promise<BrokerHistoryReadResult<BrokerHistoryPage<BrokerClosedDeal>>>;
  /**
   * Optional full closing-deal override for tests.
   * When set, bypasses exhaustive by-position walk.
   */
  fetchClosingDealsForPosition?: (args: {
    ownerUid: string;
    positionId: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }) => Promise<
    BrokerHistoryReadResult<{
      deal: BrokerClosedDeal | null;
      complete: boolean;
    }>
  >;
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

/** Max bisection pages per exhaustive walk (fail closed beyond). */
export const GH_HISTORY_MAX_PAGES = 32;
/** Do not bisect windows narrower than this. */
export const GH_HISTORY_MIN_BISECT_MS = 1_000;

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

/**
 * Bounded window anchored on Gold Hunter orderTs.
 * Never slides the interval forward such that orderTs falls outside.
 */
export function goldHunterEntryHistoryQueryWindow(args: {
  orderTs: string | null | undefined;
  nowMs?: number;
  lookbackPadMs?: number;
}): { fromTimestampMs: number; toTimestampMs: number } {
  const nowMs = args.nowMs ?? Date.now();
  const pad = args.lookbackPadMs ?? 5 * 60_000;
  const orderMs = args.orderTs ? Date.parse(args.orderTs) : NaN;
  if (!Number.isFinite(orderMs)) {
    return clampOrderTsAnchoredHistoryWindow({
      fromTimestampMs: Math.max(0, nowMs - 7 * 86_400_000),
      toTimestampMs: nowMs,
      nowMs
    });
  }
  const fromTimestampMs = Math.max(0, orderMs - pad);
  // Extend forward to now (or max 7d from from) so post-fill closes are visible.
  const toTimestampMs = Math.min(nowMs, fromTimestampMs + 7 * 86_400_000);
  return clampOrderTsAnchoredHistoryWindow({
    fromTimestampMs,
    toTimestampMs: Math.max(toTimestampMs, Math.min(nowMs, orderMs + pad)),
    nowMs
  });
}

async function fetchOrderListPage(args: {
  ownerUid: string;
  fromTimestampMs: number;
  toTimestampMs: number;
}): Promise<BrokerHistoryReadResult<BrokerHistoryPage<BrokerHistoricalOrder>>> {
  if (hooks.fetchOrderListPage) {
    return hooks.fetchOrderListPage(args);
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
    const page = await client.fetchDemoOrderList({
      accessToken,
      clientId,
      clientSecret,
      ctidTraderAccountId: accountId,
      fromTimestampMs: args.fromTimestampMs,
      toTimestampMs: args.toTimestampMs
    });
    return { ok: true, value: page };
  } catch (err) {
    return {
      ok: false,
      errorCode: err instanceof Error ? err.message.slice(0, 80) : "ORDER_LIST_FAIL"
    };
  }
}

async function fetchDealEvidencePage(args: {
  ownerUid: string;
  fromTimestampMs: number;
  toTimestampMs: number;
}): Promise<BrokerHistoryReadResult<BrokerHistoryPage<BrokerDealEvidence>>> {
  if (hooks.fetchDealEvidencePage) {
    return hooks.fetchDealEvidencePage(args);
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
    const page = await client.fetchDemoDealEvidenceList({
      accessToken,
      clientId,
      clientSecret,
      ctidTraderAccountId: accountId,
      fromTimestampMs: args.fromTimestampMs,
      toTimestampMs: args.toTimestampMs
    });
    return { ok: true, value: page };
  } catch (err) {
    return {
      ok: false,
      errorCode: err instanceof Error ? err.message.slice(0, 80) : "DEAL_LIST_FAIL"
    };
  }
}

/**
 * Walk a time window with bisection when hasMore=true.
 * Stops early if findMatch returns a hit (for clientOrderId search).
 */
export async function fetchExhaustiveHistoryPages<T>(args: {
  ownerUid: string;
  fromTimestampMs: number;
  toTimestampMs: number;
  fetchPage: (args: {
    ownerUid: string;
    fromTimestampMs: number;
    toTimestampMs: number;
  }) => Promise<BrokerHistoryReadResult<BrokerHistoryPage<T>>>;
  itemKey: (item: T) => string;
  findMatch?: (items: T[]) => T | null;
  maxPages?: number;
}): Promise<
  ExhaustiveHistoryResult<T> & { match?: T | null }
> {
  const maxPages = args.maxPages ?? GH_HISTORY_MAX_PAGES;
  let pages = 0;
  const all = new Map<string, T>();
  let earlyMatch: T | null = null;

  type Walk =
    | { ok: true; complete: true }
    | { ok: true; complete: false; reason: string }
    | { ok: false; errorCode: string };

  async function walk(from: number, to: number): Promise<Walk> {
    if (earlyMatch) return { ok: true, complete: true };
    if (pages >= maxPages) {
      return { ok: true, complete: false, reason: "MAX_PAGES_EXCEEDED" };
    }
    pages += 1;
    const page = await args.fetchPage({
      ownerUid: args.ownerUid,
      fromTimestampMs: from,
      toTimestampMs: to
    });
    if (!page.ok) return { ok: false, errorCode: page.errorCode };

    for (const item of page.value.items) {
      all.set(args.itemKey(item), item);
    }
    if (args.findMatch) {
      const hit = args.findMatch(page.value.items);
      if (hit) {
        earlyMatch = hit;
        return { ok: true, complete: true };
      }
    }

    if (!page.value.hasMore) {
      return { ok: true, complete: true };
    }

    // Truncated page — bisect time window (Spotware has no offset cursor).
    if (to - from < GH_HISTORY_MIN_BISECT_MS) {
      return { ok: true, complete: false, reason: "HAS_MORE_UNSPLITTABLE" };
    }
    const mid = from + Math.floor((to - from) / 2);
    if (mid <= from || mid >= to) {
      return { ok: true, complete: false, reason: "HAS_MORE_UNSPLITTABLE" };
    }
    const left = await walk(from, mid);
    if (!left.ok) return left;
    if (earlyMatch) return { ok: true, complete: true };
    const right = await walk(mid, to);
    if (!right.ok) return right;
    if (earlyMatch) return { ok: true, complete: true };
    if (!left.complete || !right.complete) {
      return {
        ok: true,
        complete: false,
        reason:
          (!left.complete ? left.reason : null) ??
          (!right.complete ? right.reason : null) ??
          "INCOMPLETE_BISECTION"
      };
    }
    return { ok: true, complete: true };
  }

  const clamped = clampOrderTsAnchoredHistoryWindow({
    fromTimestampMs: args.fromTimestampMs,
    toTimestampMs: args.toTimestampMs
  });
  const result = await walk(clamped.fromTimestampMs, clamped.toTimestampMs);
  if (!result.ok) return { ok: false, errorCode: result.errorCode };
  const items = [...all.values()];
  if (result.complete) {
    return {
      ok: true,
      complete: true,
      items,
      pages,
      match: earlyMatch
    };
  }
  return {
    ok: true,
    complete: false,
    items,
    pages,
    reason: result.reason,
    match: earlyMatch
  };
}

export async function fetchDemoHistoricalOrdersExhaustive(args: {
  ownerUid: string;
  fromTimestampMs: number;
  toTimestampMs: number;
  /** Stop early when this exact clientOrderId is found. */
  stopOnClientOrderId?: string;
}): Promise<ExhaustiveHistoryResult<BrokerHistoricalOrder>> {
  const want = args.stopOnClientOrderId?.trim() ?? "";
  return fetchExhaustiveHistoryPages({
    ownerUid: args.ownerUid,
    fromTimestampMs: args.fromTimestampMs,
    toTimestampMs: args.toTimestampMs,
    fetchPage: fetchOrderListPage,
    itemKey: (o) => o.orderId,
    findMatch: want
      ? (items) => findHistoricalOrderByClientOrderId(items, want)
      : undefined
  });
}

export async function fetchDemoHistoricalDealEvidenceExhaustive(args: {
  ownerUid: string;
  fromTimestampMs: number;
  toTimestampMs: number;
  /**
   * Early-stop policy:
   * - OPENING_FOR_ORDER: stop when any deal for orderId appears (positionId recovery)
   * - CLOSING_FOR_POSITION: stop only when a closing deal (netPnl) for positionId appears
   * - none / omit: fully exhaustive (required for NEVER_FOUND emptiness + close proof)
   */
  earlyStop?:
    | { mode: "OPENING_FOR_ORDER"; orderId: string }
    | { mode: "CLOSING_FOR_POSITION"; positionId: string }
    | { mode: "LABEL_MATCH"; goldHunterTradeId: string }
    | null;
}): Promise<ExhaustiveHistoryResult<BrokerDealEvidence>> {
  const early = args.earlyStop ?? null;
  return fetchExhaustiveHistoryPages({
    ownerUid: args.ownerUid,
    fromTimestampMs: args.fromTimestampMs,
    toTimestampMs: args.toTimestampMs,
    fetchPage: fetchDealEvidencePage,
    itemKey: (d) => d.dealId,
    findMatch: early
      ? (items) => {
          if (early.mode === "OPENING_FOR_ORDER") {
            return (
              items.find(
                (d) =>
                  d.orderId === early.orderId &&
                  d.positionId &&
                  !d.isClosing
              ) ??
              items.find(
                (d) => d.orderId === early.orderId && d.positionId
              ) ??
              null
            );
          }
          if (early.mode === "CLOSING_FOR_POSITION") {
            return (
              items.find(
                (d) =>
                  d.positionId === early.positionId &&
                  d.isClosing &&
                  d.close?.netPnl != null
              ) ?? null
            );
          }
          if (early.mode === "LABEL_MATCH") {
            return (
              items.find((d) => d.label === early.goldHunterTradeId) ?? null
            );
          }
          return null;
        }
      : undefined
  });
}

async function fetchDealsByPositionIdPage(args: {
  ownerUid: string;
  positionId: string;
  fromTimestampMs: number;
  toTimestampMs: number;
}): Promise<BrokerHistoryReadResult<BrokerHistoryPage<BrokerClosedDeal>>> {
  if (hooks.fetchDealsByPositionIdPage) {
    return hooks.fetchDealsByPositionIdPage(args);
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
    if (!client.fetchDemoDealsByPositionId) {
      return { ok: false, errorCode: "DEALS_BY_POSITION_UNSUPPORTED" };
    }
    const page = await client.fetchDemoDealsByPositionId({
      accessToken,
      clientId,
      clientSecret,
      ctidTraderAccountId: accountId,
      positionId: args.positionId,
      fromTimestampMs: args.fromTimestampMs,
      toTimestampMs: args.toTimestampMs
    });
    return { ok: true, value: page };
  } catch (err) {
    return {
      ok: false,
      errorCode:
        err instanceof Error ? err.message.slice(0, 80) : "DEALS_BY_POSITION_FAIL"
    };
  }
}

/**
 * Exhaustive ProtoOADealListByPositionId walk (hasMore-aware).
 * Incomplete results must never be treated as "no closing deal".
 */
export async function fetchDemoDealsByPositionIdExhaustive(args: {
  ownerUid: string;
  positionId: string;
  fromTimestampMs: number;
  toTimestampMs: number;
  /** Stop early only when a closing deal with netPnl is found. */
  stopOnClosingDeal?: boolean;
}): Promise<ExhaustiveHistoryResult<BrokerClosedDeal>> {
  const positionId = String(args.positionId);
  return fetchExhaustiveHistoryPages({
    ownerUid: args.ownerUid,
    fromTimestampMs: args.fromTimestampMs,
    toTimestampMs: args.toTimestampMs,
    fetchPage: (pageArgs) =>
      fetchDealsByPositionIdPage({
        ...pageArgs,
        positionId
      }),
    itemKey: (d) => d.dealId,
    findMatch: args.stopOnClosingDeal
      ? (items) => items.find((d) => d.netPnl != null) ?? null
      : undefined
  });
}

/** @deprecated Prefer exhaustive APIs for terminal decisions. */
export async function fetchDemoHistoricalOrders(args: {
  ownerUid: string;
  fromTimestampMs: number;
  toTimestampMs: number;
}): Promise<BrokerHistoryReadResult<BrokerHistoricalOrder[]>> {
  const ex = await fetchDemoHistoricalOrdersExhaustive(args);
  if (!ex.ok) return ex;
  return { ok: true, value: ex.items };
}

/** @deprecated Prefer exhaustive APIs for terminal decisions. */
export async function fetchDemoHistoricalDealEvidence(args: {
  ownerUid: string;
  fromTimestampMs: number;
  toTimestampMs: number;
}): Promise<BrokerHistoryReadResult<BrokerDealEvidence[]>> {
  const ex = await fetchDemoHistoricalDealEvidenceExhaustive(args);
  if (!ex.ok) return ex;
  return { ok: true, value: ex.items };
}

/**
 * Authoritative closing deal for a position — FINAL SETTLEMENT ONLY.
 *
 * Exhaustive DealListByPositionId across the full window (every hasMore page).
 * Falls back to exhaustive general DealList filtered by positionId.
 * Never early-stops after the first closing deal — cTrader may close with
 * multiple deals; partial history must not become CLOSED accounting.
 */
export async function fetchDemoClosingDealForPosition(args: {
  ownerUid: string;
  positionId: string;
  fromTimestampMs: number;
  toTimestampMs: number;
}): Promise<
  BrokerHistoryReadResult<{ deal: BrokerClosedDeal | null; complete: boolean }>
> {
  if (hooks.fetchClosingDealsForPosition) {
    return hooks.fetchClosingDealsForPosition(args);
  }

  // FINAL settlement: never stopOnClosingDeal — collect ALL closing deals.
  const byPos = await fetchDemoDealsByPositionIdExhaustive({
    ownerUid: args.ownerUid,
    positionId: args.positionId,
    fromTimestampMs: args.fromTimestampMs,
    toTimestampMs: args.toTimestampMs
  });
  if (!byPos.ok) return byPos;
  if (!byPos.complete) {
    return {
      ok: true,
      value: { deal: null, complete: false }
    };
  }
  const aggByPos = aggregateClosingDeals(byPos.items);
  if (aggByPos) {
    return { ok: true, value: { deal: aggByPos, complete: true } };
  }

  // OPTION B fallback: fully exhaustive general DealList (no early-stop).
  const general = await fetchDemoHistoricalDealEvidenceExhaustive({
    ownerUid: args.ownerUid,
    fromTimestampMs: args.fromTimestampMs,
    toTimestampMs: args.toTimestampMs
  });
  if (!general.ok) return general;
  if (!general.complete) {
    return {
      ok: true,
      value: { deal: null, complete: false }
    };
  }
  const closing = general.items
    .filter(
      (d) =>
        d.positionId === String(args.positionId) &&
        d.close != null &&
        d.close.netPnl != null
    )
    .map((d) => d.close!);
  const agg = aggregateClosingDeals(closing);
  return {
    ok: true,
    value: { deal: agg, complete: true }
  };
}

/**
 * Positive diagnostic only: early-stop when any closing deal appears.
 * MUST NOT feed applyBrokerSettledClose / CLOSED accounting.
 */
export async function fetchDemoClosingDealEvidenceEarly(args: {
  ownerUid: string;
  positionId: string;
  fromTimestampMs: number;
  toTimestampMs: number;
}): Promise<ExhaustiveHistoryResult<BrokerClosedDeal>> {
  return fetchDemoDealsByPositionIdExhaustive({
    ...args,
    stopOnClosingDeal: true
  });
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
    /** True only when the full orderTs window was exhaustively searched. */
    complete: boolean;
    incompleteReason?: string;
  }>
> {
  const window = goldHunterEntryHistoryQueryWindow({
    orderTs: args.orderTs,
    nowMs: args.nowMs
  });
  const read = await fetchDemoHistoricalOrdersExhaustive({
    ownerUid: args.ownerUid,
    ...window,
    stopOnClientOrderId: args.clientOrderId
  });
  if (!read.ok) return read;
  const order =
    findHistoricalOrderByClientOrderId(read.items, args.clientOrderId) ?? null;
  if (order) {
    // Finding the exact order is sufficient for recovery paths; completeness
    // of the rest of the window is not required once matched.
    return {
      ok: true,
      value: {
        order,
        ordersChecked: read.items.length,
        complete: true
      }
    };
  }
  if (!read.complete) {
    return {
      ok: true,
      value: {
        order: null,
        ordersChecked: read.items.length,
        complete: false,
        incompleteReason: read.reason
      }
    };
  }
  return {
    ok: true,
    value: {
      order: null,
      ordersChecked: read.items.length,
      complete: true
    }
  };
}

/**
 * Resolve positionId when historical order.positionId is null via exact
 * deal.orderId === opening order.orderId (opening deal carries positionId).
 */
export function resolvePositionIdFromDeals(args: {
  orderId: string;
  deals: readonly BrokerDealEvidence[];
}): string | null {
  const orderId = String(args.orderId);
  const opening =
    args.deals.find(
      (d) => d.orderId === orderId && d.positionId && !d.isClosing
    ) ??
    args.deals.find((d) => d.orderId === orderId && d.positionId) ??
    null;
  return opening?.positionId ? String(opening.positionId) : null;
}

export function dealsMatchingOrderOrPosition(args: {
  deals: readonly BrokerDealEvidence[];
  orderId?: string | null;
  positionId?: string | null;
}): BrokerDealEvidence[] {
  const orderId = args.orderId ? String(args.orderId) : null;
  const positionId = args.positionId ? String(args.positionId) : null;
  return args.deals.filter((d) => {
    if (orderId && d.orderId && d.orderId === orderId) return true;
    if (positionId && d.positionId && d.positionId === positionId) return true;
    return false;
  });
}
