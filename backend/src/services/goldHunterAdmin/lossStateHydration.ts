/**
 * Rebuild process-local Gold Hunter loss/re-entry controls from authoritative
 * settled Demo trades before the quote worker may produce executable entries.
 *
 * Persisted selector telemetry is status-only. Broker-settled trade rows are the
 * source of truth so a worker restart cannot silently reset the loss streak,
 * rolling-R circuit breaker, or last-loss anti-churn memory.
 */
import { frozenGhFastSoakConfig } from "./abc";
import {
  computeSettledRealisedR,
  resolveOriginalRiskPrice
} from "./abc/settledRealisedR";
import { getGoldHunterStrategySelector } from "./strategySelector";
import { listGoldHunterDemoTrades } from "./tradeStore";
import type { GoldHunterDemoTrade } from "./types";

type SettledGoldHunterTrade = GoldHunterDemoTrade & {
  result: "WIN" | "LOSS" | "BREAKEVEN";
};

function isSettledTrade(
  trade: GoldHunterDemoTrade
): trade is SettledGoldHunterTrade {
  return (
    trade.status === "CLOSED" &&
    (trade.result === "WIN" ||
      trade.result === "LOSS" ||
      trade.result === "BREAKEVEN")
  );
}

function closedAtMs(trade: GoldHunterDemoTrade): number {
  const close = Date.parse(trade.closeTs ?? "");
  if (Number.isFinite(close)) return close;
  const order = Date.parse(trade.orderTs ?? "");
  return Number.isFinite(order) ? order : 0;
}

function realisedR(trade: GoldHunterDemoTrade): number | null {
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

export type GoldHunterLossHydrationResult = {
  closedTradesLoaded: number;
  replayed: number;
  lastClosedTradeId: string | null;
};

export async function hydrateGoldHunterLossStateFromClosedTrades(
  ownerUid: string
): Promise<GoldHunterLossHydrationResult> {
  const cfg = frozenGhFastSoakConfig();
  const rows = await listGoldHunterDemoTrades(ownerUid, {
    // Keep enough history for the rolling window plus restart diagnostics.
    limit: Math.max(50, cfg.slcRollingWindowTrades * 4)
  });
  const closed = rows
    .filter(isSettledTrade)
    .sort((a, b) => {
      const byTime = closedAtMs(a) - closedAtMs(b);
      return byTime !== 0
        ? byTime
        : a.goldHunterTradeId.localeCompare(b.goldHunterTradeId);
    });

  const selector = getGoldHunterStrategySelector(ownerUid);
  for (const trade of closed) {
    selector.notifyTradeClosed({
      side: trade.side,
      setup: trade.setup,
      entryPrice: trade.entry,
      exitPrice: trade.exit,
      result: trade.result,
      opportunityId: trade.signalId ?? null,
      closedAtMs: closedAtMs(trade),
      realisedR: realisedR(trade),
      tradeId: trade.goldHunterTradeId
    });
  }

  const state = selector.getLossControllerEntryState();
  return {
    closedTradesLoaded: closed.length,
    replayed: closed.length,
    lastClosedTradeId: state.lastClosedTradeId
  };
}
