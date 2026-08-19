/**
 * Authoritative Gold Hunter Demo close settlement from broker closing deals.
 * Never invent netPnlEur. CLOSED only when broker evidence confirms settlement.
 */
import type { BrokerClosedDeal } from "../broker/ctrader/openApiClient";
import { fetchConfirmedCloseForPosition } from "../broker/ctrader/demoPositionMutations";
import { upsertGoldHunterDemoTrade } from "./tradeStore";
import {
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "./types";
import { getGoldHunterStrategySelector } from "./strategySelector";
import {
  computeSettledRealisedR,
  resolveOriginalRiskPrice
} from "./abc/settledRealisedR";

export type CloseSettlementHooks = {
  fetchClose?: (args: {
    ownerUid: string;
    positionId: string;
    openedAt: string;
  }) => Promise<BrokerClosedDeal | null>;
};

let hooks: CloseSettlementHooks = {};

export function setGoldHunterCloseSettlementHooksForTests(
  h: CloseSettlementHooks
): void {
  hooks = h;
}

export function resetGoldHunterCloseSettlementHooksForTests(): void {
  hooks = {};
}

/**
 * Close-side states that may still need broker deal P/L (unresolved daily risk).
 * CLOSE_REQUESTED still occupies max-open until broker absence is proven.
 */
export function isGoldHunterCloseSettlementPending(
  status: GoldHunterDemoTrade["status"]
): boolean {
  return (
    status === "CLOSE_REQUESTED" ||
    status === "CLOSE_ACCEPTED_PENDING_SETTLEMENT"
  );
}

/**
 * Broker close already accepted / position proven absent — deal P/L retry only.
 * Safe to settle without re-checking open positions (does not occupy max-open).
 */
export function isGoldHunterCloseAcceptedPendingSettlement(
  status: GoldHunterDemoTrade["status"]
): boolean {
  return status === "CLOSE_ACCEPTED_PENDING_SETTLEMENT";
}

export function resultFromNetPnl(net: number): "WIN" | "LOSS" | "BREAKEVEN" {
  if (net > 0.01) return "WIN";
  if (net < -0.01) return "LOSS";
  return "BREAKEVEN";
}

/**
 * True settled realised R from entry/exit / original risk.
 * Returns null when inputs are incomplete — never invents maeR/mfe approximations.
 */
export function realisedRFromSettledDemoTrade(
  trade: GoldHunterDemoTrade
): number | null {
  return computeSettledRealisedR({
    side: trade.side,
    entry: trade.entry,
    exit: trade.exit,
    originalRiskPrice: resolveOriginalRiskPrice({
      side: trade.side,
      entry: trade.entry,
      stop: trade.stop,
      initialRiskPrice: trade.initialRiskPrice
    })
  });
}

/**
 * Exactly-once-safe selector notify for a settled Demo GH trade.
 */
export function notifySelectorOfSettledGoldHunterClose(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
}): void {
  const { trade } = args;
  try {
    getGoldHunterStrategySelector(args.ownerUid).notifyTradeClosed({
      side: trade.side,
      setup: trade.setup,
      entryPrice: trade.entry,
      result: trade.result === "OPEN" ? null : trade.result,
      opportunityId: trade.signalId ?? null,
      closedAtMs: Date.parse(trade.closeTs ?? "") || Date.now(),
      realisedR: realisedRFromSettledDemoTrade(trade),
      tradeId: trade.goldHunterTradeId
    });
  } catch {
    /* best-effort anti-churn / LC notify */
  }
}

/**
 * Apply a confirmed broker closing deal → status CLOSED with real P/L.
 */
export function applyBrokerSettledClose(args: {
  trade: GoldHunterDemoTrade;
  deal: BrokerClosedDeal;
  exitReason?: string | null;
  nowIso?: string;
}): GoldHunterDemoTrade {
  const { trade, deal } = args;
  if (deal.netPnl == null || !Number.isFinite(deal.netPnl)) {
    throw new Error("BROKER_NET_PNL_REQUIRED");
  }
  const closeTs = deal.closedAt ?? args.nowIso ?? new Date().toISOString();
  const fillMs = Date.parse(trade.fillTs ?? trade.orderTs ?? "");
  const closeMs = Date.parse(closeTs);
  const durationMs =
    Number.isFinite(fillMs) && Number.isFinite(closeMs)
      ? Math.max(0, closeMs - fillMs)
      : trade.durationMs;
  const net = deal.netPnl;
  const mfeEur = trade.mfeEur ?? null;
  let profitSurrenderEur = trade.profitSurrenderEur ?? null;
  let profitRetentionRatio = trade.profitRetentionRatio ?? null;
  if (
    mfeEur != null &&
    Number.isFinite(mfeEur) &&
    Number.isFinite(net) &&
    mfeEur > 0
  ) {
    profitSurrenderEur = mfeEur - net;
    profitRetentionRatio = net / mfeEur;
  }
  return {
    ...trade,
    strategy: GH_ADMIN_STRATEGY_ID,
    environment: "DEMO",
    status: "CLOSED",
    result: resultFromNetPnl(deal.netPnl),
    exit: deal.closePrice ?? trade.exit,
    closeTs,
    brokerSettlementTs: closeTs,
    closeAcceptedTs: trade.closeAcceptedTs ?? closeTs,
    exitReason: args.exitReason ?? trade.exitReason,
    durationMs: durationMs ?? null,
    grossPnlEur: deal.grossPnl,
    netPnlEur: deal.netPnl,
    commissionEur: deal.commission,
    swapEur: deal.swap,
    brokerDealId: deal.dealId,
    filledVolumeLots: deal.closedVolumeLots ?? trade.filledVolumeLots,
    errorCode: null,
    profitSurrenderEur,
    profitRetentionRatio
  };
}

/**
 * Query broker for closing deal and settle if net P/L is present.
 * Returns settled trade, or pending trade (never fake CLOSED with null P/L).
 */
export async function settleGoldHunterCloseFromBroker(args: {
  ownerUid: string;
  trade: GoldHunterDemoTrade;
}): Promise<{
  settled: boolean;
  trade: GoldHunterDemoTrade;
}> {
  const { trade } = args;
  if (!trade.brokerPositionId) {
    const pending: GoldHunterDemoTrade = {
      ...trade,
      status: "PENDING_RECONCILIATION",
      errorCode: trade.errorCode ?? "CLOSE_NO_POSITION_ID",
      netPnlEur: null,
      grossPnlEur: null
    };
    await upsertGoldHunterDemoTrade(args.ownerUid, pending);
    return { settled: false, trade: pending };
  }

  const openedAt = trade.fillTs ?? trade.orderTs ?? new Date().toISOString();
  const fetch =
    hooks.fetchClose ??
    ((a: { ownerUid: string; positionId: string; openedAt: string }) =>
      fetchConfirmedCloseForPosition(a));

  let deal: BrokerClosedDeal | null = null;
  try {
    deal = await fetch({
      ownerUid: args.ownerUid,
      positionId: trade.brokerPositionId,
      openedAt
    });
  } catch {
    deal = null;
  }

  if (deal && deal.netPnl != null && Number.isFinite(deal.netPnl)) {
    const settled = applyBrokerSettledClose({
      trade,
      deal,
      exitReason: trade.exitReason
    });
    await upsertGoldHunterDemoTrade(args.ownerUid, settled);
    notifySelectorOfSettledGoldHunterClose({
      ownerUid: args.ownerUid,
      trade: settled
    });
    return { settled: true, trade: settled };
  }

  const pending: GoldHunterDemoTrade = {
    ...trade,
    status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
    result: null,
    netPnlEur: null,
    grossPnlEur: null,
    errorCode: trade.errorCode ?? "CLOSE_SETTLEMENT_PENDING"
  };
  await upsertGoldHunterDemoTrade(args.ownerUid, pending);
  return { settled: false, trade: pending };
}
