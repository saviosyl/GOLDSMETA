/**
 * FAST_AUTOTRADE_V1 position management — shorter, volatility-aware exits.
 * Never widens SL. No martingale / grid / averaging.
 */

import type { FastAutoTradeConfig } from "./config";
import { DEFAULT_FAST_AUTOTRADE_CONFIG } from "./config";
import type { FastManagementInput, FastManagementResult } from "./types";

function rMultiple(input: FastManagementInput): number | null {
  const risk =
    input.initialSl != null ? Math.abs(input.entry - input.initialSl) : null;
  if (risk == null || !(risk > 0)) return null;
  const move =
    input.side === "BUY"
      ? input.currentPrice - input.entry
      : input.entry - input.currentPrice;
  return move / risk;
}

export function evaluateFastManagement(
  input: FastManagementInput,
  config: FastAutoTradeConfig = DEFAULT_FAST_AUTOTRADE_CONFIG
): FastManagementResult {
  const r = rMultiple(input);
  const holdMs = input.nowMs - input.openedAtMs;

  if (input.oppositeStructureBreak && (r == null || r < 0.35)) {
    return {
      action: "EXIT_STRUCTURE",
      newStopLoss: null,
      reason: "Opposite micro-structure break after entry"
    };
  }

  if (input.momentumCollapsed && (r == null || r < 0)) {
    return {
      action: "EXIT_MOMENTUM",
      newStopLoss: null,
      reason: "Momentum that justified the entry collapsed"
    };
  }

  const stagnant =
    holdMs >= config.staleTradeDurationMs && (r == null || Math.abs(r) < 0.25);
  if (stagnant && input.momentumCollapsed) {
    return {
      action: "EXIT_STALE",
      newStopLoss: null,
      reason: "Stale scalp — expected move failed to develop"
    };
  }

  if (
    !input.alreadyBreakeven &&
    r != null &&
    r >= config.breakEvenTriggerR &&
    input.entry > 0
  ) {
    return {
      action: "MOVE_SL_TO_BREAKEVEN",
      newStopLoss: input.entry,
      reason: `Price reached ${config.breakEvenTriggerR}R — move SL to break-even`
    };
  }

  if (
    input.alreadyBreakeven &&
    r != null &&
    r >= config.trailingTriggerR &&
    input.atr != null &&
    input.atr > 0
  ) {
    const trail =
      input.side === "BUY"
        ? input.currentPrice - input.atr * 0.7
        : input.currentPrice + input.atr * 0.7;
    const current = input.currentSl;
    const improves =
      current == null ||
      (input.side === "BUY" ? trail > current : trail < current);
    if (improves) {
      return {
        action: "TRAIL_STOP",
        newStopLoss: trail,
        reason: "Trail stop after favourable extension"
      };
    }
  }

  return { action: "HOLD", newStopLoss: null, reason: "Structure still valid" };
}
