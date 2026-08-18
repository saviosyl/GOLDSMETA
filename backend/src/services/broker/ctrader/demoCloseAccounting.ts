/**
 * Authoritative Demo close accounting from broker deals.
 *
 * Normal path: known brokerPositionId → closing deal → lifecycle + counters.
 * Repair path: recover unaccounted OPEN / CLOSED-without-PnL trades via deal list.
 * Reconcile must never invent P/L or erase confirmed broker P/L.
 */

import { getConnection } from "./connectionStore";
import {
  createOpenApiClient,
  aggregateClosingDeals,
  type BrokerClosedDeal
} from "./openApiClient";
import { loadCTraderConfig } from "./config";
import {
  loadTokenEncryptionSecret,
  persistRotatedTokensAtomic
} from "./connectionStore";
import { refreshAccessToken } from "./oauth";
import { decryptTokenPayload, encryptTokenPayload } from "./tokenCrypto";
import {
  getActiveQualificationAccountId,
  getQualificationDoc
} from "./qualificationStore";
import { getPositionLifecycle, savePositionLifecycle } from "./positionLifecycleStore";
import { updateAutoTradeJournalOnClose } from "./autoTradeJournal";
import { logger } from "../../logging/logger";
import { computeCloseDiagnostics } from "./fastAutoTrade/closeDiagnostics";

export type DemoCloseRepairResult = {
  examined: number;
  repaired: number;
  skipped: number;
  errors: string[];
};

async function ensureFreshAccessToken(ownerUid: string): Promise<{
  accessToken: string;
  ctidTraderAccountId: string;
}> {
  const cfg = loadCTraderConfig();
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  if (!cfg.configured || !clientId || !clientSecret) {
    throw new Error("CONFIGURATION_REQUIRED");
  }
  const connection = await getConnection(ownerUid);
  if (!connection?.selectedAccountId) throw new Error("CTRADER_ACCOUNT_NOT_SELECTED");
  if (connection.selectedAccountIsLive || connection.environment === "LIVE") {
    throw new Error("LIVE_ACCOUNT_MUTATION_DENIED");
  }
  const secret = loadTokenEncryptionSecret();
  if (!secret) throw new Error("[REDACTED]_KEY");
  const payload = JSON.parse(
    decryptTokenPayload(connection.tokens.ciphertext, secret)
  ) as { accessToken?: string; refreshToken?: string };
  if (!payload.accessToken || !payload.refreshToken) {
    throw new Error("CTRADER_TOKENS_MISSING");
  }
  let accessToken = payload.accessToken;
  const expiresAt = Date.parse(connection.tokens.accessExpiresAt);
  const stale = !Number.isFinite(expiresAt) || expiresAt < Date.now() + 60_000;
  if (stale) {
    const rotated = await refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken: payload.refreshToken
    });
    const ciphertext = encryptTokenPayload(
      JSON.stringify({
        accessToken: rotated.accessToken,
        refreshToken: rotated.refreshToken ?? payload.refreshToken
      }),
      secret
    );
    await persistRotatedTokensAtomic({
      ownerUid,
      expectedCiphertext: connection.tokens.ciphertext,
      expectedTokenVersion: connection.tokens.tokenVersion ?? 0,
      newTokens: {
        ciphertext,
        accessExpiresAt: new Date(
          Date.now() + (rotated.expiresIn ?? 3600) * 1000
        ).toISOString(),
        refreshedAt: new Date().toISOString(),
        tokenVersion: (connection.tokens.tokenVersion ?? 0) + 1
      }
    });
    accessToken = rotated.accessToken;
  }
  return {
    accessToken,
    ctidTraderAccountId: connection.selectedAccountId
  };
}

async function fetchClosingDealForPosition(args: {
  ownerUid: string;
  positionId: string;
  openedAt: string;
}): Promise<BrokerClosedDeal | null> {
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  const { accessToken, ctidTraderAccountId } = await ensureFreshAccessToken(
    args.ownerUid
  );
  const client = createOpenApiClient();
  const openedMs = Date.parse(args.openedAt);
  const fromTimestampMs = Number.isFinite(openedMs)
    ? Math.max(0, openedMs - 60_000)
    : Date.now() - 7 * 86_400_000;
  const toTimestampMs = Date.now() + 60_000;
  if (client.fetchDemoDealsByPositionId) {
    const deals = await client.fetchDemoDealsByPositionId({
      accessToken,
      clientId,
      clientSecret,
      ctidTraderAccountId,
      positionId: args.positionId,
      fromTimestampMs,
      toTimestampMs
    });
    const agg = aggregateClosingDeals(deals);
    if (agg) return agg;
  }
  if (client.fetchDemoDealList) {
    const deals = await client.fetchDemoDealList({
      accessToken,
      clientId,
      clientSecret,
      ctidTraderAccountId,
      fromTimestampMs,
      toTimestampMs
    });
    return aggregateClosingDeals(
      deals.filter((d) => d.positionId === args.positionId)
    );
  }
  return null;
}

/**
 * Apply a confirmed broker close to lifecycle + qualification + journal + daily safety.
 * Idempotent: never double-counts; never overwrites confirmed broker P/L with null.
 */
export async function applyConfirmedDemoBrokerClose(args: {
  uid: string;
  correlationId: string;
  brokerPositionId: string;
  deal: BrokerClosedDeal;
  closeReason?: string;
  side?: "BUY" | "SELL";
  openedAt?: string;
}): Promise<{ applied: boolean; reason: string }> {
  if (args.deal.netPnl == null) {
    return { applied: false, reason: "missing_net_pnl" };
  }
  const closedAt = args.deal.closedAt ?? new Date().toISOString();
  const reason = args.closeReason ?? "Broker closing deal confirmed";

  // Dynamic import avoids circular init with qualificationService / lifecycle.
  const { markQualificationTradeClosed } = await import(
    "./qualificationService.js"
  );
  const { createDemoPositionLifecycle } = await import(
    "./demoPositionLifecycle.js"
  );

  let life = await getPositionLifecycle(args.uid, args.correlationId);
  if (life?.status === "CLOSED" && life.brokerPnlConfirmed && life.netPnl != null) {
    // Preserve real broker P/L — reconcile must not erase it.
    await markQualificationTradeClosed({
      uid: args.uid,
      correlationId: args.correlationId,
      pnl: life.netPnl,
      grossPnl: life.grossPnl,
      commission: life.commission,
      swap: life.swap,
      closePrice: life.closePrice,
      closeReason: reason,
      brokerDealId: life.brokerDealId,
      closedAt: life.closedAt,
      strategyId: life.strategyId ?? null
    });
    return { applied: false, reason: "already_closed_confirmed" };
  }

  if (!life) {
    const conn = await getConnection(args.uid);
    life = await createDemoPositionLifecycle({
      uid: args.uid,
      correlationId: args.correlationId,
      brokerOrderId: null,
      brokerPositionId: args.brokerPositionId,
      accountId: conn?.selectedAccountId ?? null,
      accountMasked: conn?.selectedAccountMasked ?? null,
      side: args.side ?? "BUY",
      entry: null,
      stopLoss: null,
      lots: args.deal.closedVolumeLots,
      qualificationStage: null,
      decisionId: null,
      source: "demo_auto",
      openedAt: args.openedAt ?? closedAt
    });
  }

  if (life.status !== "CLOSED" || !life.brokerPnlConfirmed) {
    const diagnostics = computeCloseDiagnostics({
      side: life.side,
      brokerStopLoss: life.currentSl ?? life.initialSl,
      closePrice: args.deal.closePrice,
      fillPrice: life.entry,
      filledLots: life.lots ?? life.remainingLots,
      grossPnl: args.deal.grossPnl,
      commission: args.deal.commission,
      swap: args.deal.swap,
      netPnl: args.deal.netPnl
    });
    const next = {
      ...life,
      brokerPositionId: life.brokerPositionId ?? args.brokerPositionId,
      status: "CLOSED" as const,
      closedAt,
      realisedPnl: args.deal.netPnl,
      brokerPnlConfirmed: true,
      closePrice: args.deal.closePrice,
      grossPnl: args.deal.grossPnl,
      commission: args.deal.commission,
      swap: args.deal.swap,
      netPnl: args.deal.netPnl,
      brokerDealId: args.deal.dealId,
      managementState: "CLOSED" as const,
      currentRisk: 0,
      updatedAt: new Date().toISOString(),
      closeDiagnostics: diagnostics
    };
    await savePositionLifecycle(next);
  }

  await markQualificationTradeClosed({
    uid: args.uid,
    correlationId: args.correlationId,
    pnl: args.deal.netPnl,
    grossPnl: args.deal.grossPnl,
    commission: args.deal.commission,
    swap: args.deal.swap,
    closePrice: args.deal.closePrice,
    closeReason: reason,
    brokerDealId: args.deal.dealId,
    brokerPositionId: args.brokerPositionId,
    brokerOrderId: args.deal.orderId,
    closedAt,
    strategyId: life.strategyId ?? null
  });

  try {
    await updateAutoTradeJournalOnClose({
      uid: args.uid,
      correlationId: args.correlationId,
      pnl: args.deal.netPnl,
      closedAt,
      reasonForExit: reason,
      exitPrice: args.deal.closePrice,
      managementActions: ["BROKER_CLOSE"],
      durationSeconds: null,
      slTpOutcome: null,
      brokerPnlConfirmed: true,
      brokerDealId: args.deal.dealId,
      grossPnl: args.deal.grossPnl,
      commission: args.deal.commission,
      swap: args.deal.swap
    });
  } catch {
    /* journal best-effort */
  }

  return { applied: true, reason: "closed" };
}

/**
 * Repair Demo trades that are OPEN (or CLOSED without counted PnL) when the
 * broker position is gone and a closing deal is available.
 */
export async function repairUnaccountedDemoCloses(
  uid: string
): Promise<DemoCloseRepairResult> {
  const result: DemoCloseRepairResult = {
    examined: 0,
    repaired: 0,
    skipped: 0,
    errors: []
  };
  const accountId = await getActiveQualificationAccountId(uid);
  if (!accountId) return result;
  const doc = await getQualificationDoc(uid, accountId);
  if (!doc) return result;

  const candidates = [
    ...doc.controlledTrades.map((t) => ({
      correlationId: t.correlationId,
      brokerPositionId: t.brokerPositionId,
      at: t.at,
      status: t.status,
      counted: t.counted,
      pnl: t.pnl,
      side: t.direction as "BUY" | "SELL"
    })),
    ...doc.demoAutoTrades.map((t) => ({
      correlationId: t.correlationId,
      brokerPositionId: t.brokerPositionId ?? null,
      at: t.at,
      status: t.status,
      counted: t.counted,
      pnl: t.pnl,
      side: t.direction as "BUY" | "SELL"
    }))
  ].filter(
    (t) =>
      t.status === "OPEN" ||
      (t.status === "CLOSED" && (!t.counted || t.pnl == null))
  );

  for (const trade of candidates) {
    result.examined += 1;
    if (!trade.brokerPositionId) {
      result.skipped += 1;
      continue;
    }
    try {
      const deal = await fetchClosingDealForPosition({
        ownerUid: uid,
        positionId: trade.brokerPositionId,
        openedAt: trade.at
      });
      if (!deal || deal.netPnl == null) {
        result.skipped += 1;
        continue;
      }
      const applied = await applyConfirmedDemoBrokerClose({
        uid,
        correlationId: trade.correlationId,
        brokerPositionId: trade.brokerPositionId,
        deal,
        closeReason: "Broker stop/close deal repair",
        side: trade.side,
        openedAt: trade.at
      });
      if (applied.applied) result.repaired += 1;
      else result.skipped += 1;
    } catch (e) {
      result.errors.push(
        e instanceof Error ? e.message : "repair_failed"
      );
    }
  }

  if (result.repaired > 0) {
    logger.info("Demo close accounting repair", { uid, ...result });
  }
  return result;
}

/**
 * When ghost reconcile finds broker flat, attempt deal-based close repair
 * instead of marking trades CLOSED with null PnL.
 */
export async function reconcileClosedTradesWithoutErasingPnl(
  uid: string
): Promise<DemoCloseRepairResult> {
  return repairUnaccountedDemoCloses(uid);
}

/** Pure helper for tests — decide if a reconcile patch may overwrite PnL. */
export function mayOverwriteBrokerPnl(args: {
  existingConfirmed: boolean;
  existingNetPnl: number | null;
  incomingNetPnl: number | null;
}): boolean {
  if (
    args.existingConfirmed &&
    args.existingNetPnl != null &&
    args.incomingNetPnl == null
  ) {
    return false;
  }
  return true;
}
