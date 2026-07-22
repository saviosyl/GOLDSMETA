/**
 * Deterministic SHADOW exit-rule evaluation for GoldMeta-managed positions.
 */

import type { StockExitReason } from "./featureFlags";
import type { StockManagedPosition } from "./types";

export type ExitRuleQuote = {
  last: number;
  bid?: number | null;
  ask?: number | null;
};

export type ExitRuleIndicators = {
  vwap?: number | null;
  ema21?: number | null;
  ema50?: number | null;
  ema200?: number | null;
  rsi?: number | null;
  broadMarketTrend?: string | null;
  minutesToClose?: number | null;
};

export type ExitRuleLimits = {
  maxPositionDurationMinutes: number;
  forceCloseBeforeCloseMinutes: number;
  /** Trailing distance as fraction of entry (e.g. 0.01 = 1%). */
  trailingStopPct?: number;
  /** Arm break-even after this fraction of entry→TP progress. */
  breakEvenArmPct?: number;
};

export type ExitEvaluation = {
  exitReason: StockExitReason | null;
  /** Updated high-water mark for trailing stops. */
  highWaterMark: number;
  /** Whether break-even stop should be applied. */
  breakEvenArmed: boolean;
  /** Effective stop after trailing / break-even adjustments. */
  effectiveStop: number | null;
};

/**
 * Evaluate exit rules in priority order. Returns the first matching reason.
 */
export function evaluateShadowExitRules(args: {
  position: StockManagedPosition;
  quote: ExitRuleQuote;
  indicators: ExitRuleIndicators;
  limits: ExitRuleLimits;
  nowMs?: number;
}): ExitEvaluation {
  const { position, quote, indicators, limits } = args;
  const nowMs = args.nowMs ?? Date.now();
  const highWaterMark = Math.max(position.highWaterMark ?? position.entryPrice, quote.last);
  const armPct = limits.breakEvenArmPct ?? 0.5;
  const trailPct = limits.trailingStopPct ?? 0.01;
  const tpDistance = position.takeProfit != null ? position.takeProfit - position.entryPrice : 0;
  const progress =
    tpDistance > 0 ? (highWaterMark - position.entryPrice) / tpDistance : 0;
  const breakEvenArmed = Boolean(position.breakEvenArmed) || progress >= armPct;

  let effectiveStop = position.stop;
  if (breakEvenArmed) {
    const beStop = position.entryPrice;
    effectiveStop = effectiveStop == null ? beStop : Math.max(effectiveStop, beStop);
  }
  const trailingStop = highWaterMark * (1 - trailPct);
  effectiveStop = effectiveStop == null ? trailingStop : Math.max(effectiveStop, trailingStop);

  const holdMinutes = (nowMs - Date.parse(position.openedAt)) / 60_000;

  const checks: Array<{ when: boolean; reason: StockExitReason }> = [
    {
      when: effectiveStop != null && quote.last <= effectiveStop && breakEvenArmed && quote.last >= position.entryPrice * 0.999,
      reason: "BREAK_EVEN"
    },
    {
      when: effectiveStop != null && quote.last <= effectiveStop && quote.last < (position.stop ?? effectiveStop),
      reason: "TRAILING_STOP"
    },
    {
      when: position.stop != null && quote.last <= position.stop && !breakEvenArmed,
      reason: "HARD_STOP"
    },
    {
      when: position.takeProfit != null && quote.last >= position.takeProfit,
      reason: "TAKE_PROFIT"
    },
    {
      when:
        indicators.vwap != null &&
        quote.last < indicators.vwap &&
        (position.currentExitRule === "VWAP_LOSS" || position.currentExitRule === "HARD_STOP"),
      reason: "VWAP_LOSS"
    },
    {
      when:
        indicators.rsi != null &&
        indicators.rsi < 35 &&
        indicators.ema21 != null &&
        quote.last < indicators.ema21,
      reason: "INDICATOR_REVERSAL"
    },
    {
      when:
        (indicators.broadMarketTrend != null &&
          /DOWN|BEAR|INVALID/i.test(indicators.broadMarketTrend)) ||
        (indicators.ema50 != null &&
          indicators.ema200 != null &&
          indicators.ema50 < indicators.ema200 &&
          quote.last < indicators.ema50),
      reason: "TREND_INVALIDATION"
    },
    {
      when: holdMinutes >= limits.maxPositionDurationMinutes,
      reason: "MAX_HOLDING_TIME"
    },
    {
      when:
        indicators.minutesToClose != null &&
        indicators.minutesToClose <= limits.forceCloseBeforeCloseMinutes,
      reason: "END_OF_DAY"
    }
  ];

  // Prefer hard stop / trailing / BE when price is through effective stop
  if (effectiveStop != null && quote.last <= effectiveStop) {
    const nearEntry =
      quote.last <= position.entryPrice * 1.001 && quote.last >= position.entryPrice * 0.999;
    if (breakEvenArmed && nearEntry) {
      return { exitReason: "BREAK_EVEN", highWaterMark, breakEvenArmed, effectiveStop };
    }
    if (position.stop != null && quote.last <= position.stop && highWaterMark <= position.entryPrice) {
      return { exitReason: "HARD_STOP", highWaterMark, breakEvenArmed, effectiveStop };
    }
    return { exitReason: "TRAILING_STOP", highWaterMark, breakEvenArmed, effectiveStop };
  }

  for (const check of checks) {
    if (
      check.reason === "BREAK_EVEN" ||
      check.reason === "TRAILING_STOP" ||
      check.reason === "HARD_STOP"
    ) {
      continue;
    }
    if (check.when) {
      return { exitReason: check.reason, highWaterMark, breakEvenArmed, effectiveStop };
    }
  }

  return { exitReason: null, highWaterMark, breakEvenArmed, effectiveStop };
}

export type ShadowExitAccounting = {
  exitAt: string;
  exitPrice: number;
  entryPrice: number;
  quantity: number;
  grossPnl: number;
  estimatedSpreadSlippage: number;
  estimatedFxImpact: number;
  netRealizedPnl: number;
  exitReason: StockExitReason;
  holdingDurationMinutes: number;
  strategy: string;
  confidenceAtEntry: number | null;
};

export function calculateShadowExitAccounting(args: {
  position: StockManagedPosition;
  exitPrice: number;
  exitReason: StockExitReason;
  exitAt: string;
  spreadSlippageBps?: number | null;
  fxImpactPct?: number | null;
  strategy: string;
  confidenceAtEntry: number | null;
}): ShadowExitAccounting {
  const { position, exitPrice, exitReason, exitAt, strategy, confidenceAtEntry } = args;
  const grossPnl = (exitPrice - position.entryPrice) * position.quantity;
  const notional = position.entryPrice * position.quantity;
  const slipBps = args.spreadSlippageBps ?? 0;
  const estimatedSpreadSlippage = -Math.abs((notional * slipBps) / 10_000);
  const fxPct = args.fxImpactPct ?? 0;
  const estimatedFxImpact = -Math.abs(notional * (fxPct / 100));
  const netRealizedPnl = grossPnl + estimatedSpreadSlippage + estimatedFxImpact;
  const holdingDurationMinutes =
    (Date.parse(exitAt) - Date.parse(position.openedAt)) / 60_000;

  return {
    exitAt,
    exitPrice,
    entryPrice: position.entryPrice,
    quantity: position.quantity,
    grossPnl,
    estimatedSpreadSlippage,
    estimatedFxImpact,
    netRealizedPnl,
    exitReason,
    holdingDurationMinutes,
    strategy,
    confidenceAtEntry
  };
}
