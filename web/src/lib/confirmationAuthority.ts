/**
 * Single authoritative 5M confirmation state for plan UI.
 * Bearish rejection must not confirm a bullish plan (and vice versa).
 */

import type { Confirmation5M, IntradayPlan, TimeframeAlignment } from "../types/intradayPlan";
import type { PlanColourTone } from "./planDisplay";

export type AuthoritativeConfirmation = {
  state: string;
  label: string;
  meaningful: boolean;
  supportsPlan: boolean;
  detail: string;
  tone: PlanColourTone;
};

export function resolveAuthoritativeConfirmation(args: {
  confirmationState?: string | null;
  candleClassification?: string | null;
  direction?: string | null;
  action?: string | null;
}): AuthoritativeConfirmation {
  const raw = String(args.confirmationState ?? args.candleClassification ?? "NONE").toUpperCase();
  const state = raw.replace(/\s+/g, "_");
  const direction = String(args.direction ?? args.action ?? "").toUpperCase();
  const isBuy = direction.includes("BUY") || direction.includes("BULL");
  const isSell = direction.includes("SELL") || direction.includes("BEAR");

  const isRejection = state.includes("REJECTION");
  const isBreakout = state.includes("BREAKOUT");
  const isFailed = state.includes("FAILED") || state.includes("INVALID");
  const isHeld = state.includes("HELD") || (state.includes("CONFIRMED") && !isRejection && !isBreakout);
  const isPending =
    !state ||
    state === "NONE" ||
    state === "OUTSIDE_ZONE" ||
    state === "APPROACHING_ZONE" ||
    state === "INSIDE_ZONE" ||
    state === "CANDLE_FORMING" ||
    state === "RETEST_PENDING" ||
    state === "PENDING";

  if (isPending) {
    return {
      state: state || "NONE",
      label: "Pending",
      meaningful: false,
      supportsPlan: false,
      detail: "Waiting for a meaningful 5-minute confirmation state.",
      tone: "wait"
    };
  }

  // Bearish rejection cannot confirm a long plan.
  if (isBuy && isRejection && !state.includes("BULLISH")) {
    return {
      state: "CONFIRMATION_FAILED",
      label: "Rejection — does not confirm long",
      meaningful: true,
      supportsPlan: false,
      detail:
        "Bearish rejection cannot confirm a bullish plan unless classified as bullish rejection from verified support.",
      tone: "notrade"
    };
  }

  // Bullish breakout cannot confirm a short plan.
  if (isSell && isBreakout && !state.includes("BEARISH")) {
    return {
      state: "CONFIRMATION_FAILED",
      label: "Breakout — does not confirm short",
      meaningful: true,
      supportsPlan: false,
      detail: "Bullish breakout cannot confirm a bearish plan.",
      tone: "notrade"
    };
  }

  let supportsPlan = false;
  if (isBuy) {
    supportsPlan = (isBreakout || isHeld || state.includes("BULLISH")) && !isFailed;
  } else if (isSell) {
    supportsPlan = (isRejection || isHeld || state.includes("BEARISH")) && !isFailed;
  }

  const tone: PlanColourTone = isFailed
    ? "notrade"
    : supportsPlan
      ? isSell
        ? "sell"
        : "buy"
      : isRejection
        ? "sell"
        : "wait";

  return {
    state,
    label: state.replace(/_/g, " "),
    meaningful: true,
    supportsPlan,
    detail: supportsPlan
      ? `5M confirmation supports the plan.`
      : `5M state ${state.replace(/_/g, " ")} does not confirm the plan.`,
    tone
  };
}

export function toConfirmation5m(auth: AuthoritativeConfirmation): Confirmation5M {
  return {
    state: auth.state,
    label: auth.label,
    meaningful: auth.meaningful,
    detail: auth.detail
  };
}

/** Build timeframe alignment whose 5M cell matches the authoritative confirmation. */
export function alignTimeframesWithConfirmation(
  _plan: IntradayPlan,
  auth: AuthoritativeConfirmation,
  base?: TimeframeAlignment | null
): TimeframeAlignment {
  void _plan;
  const cells = (base?.cells?.length ? base.cells : []).map((cell) => {
    if (cell.timeframe !== "5M") return cell;
    return {
      ...cell,
      direction: auth.label,
      label: "Entry confirm",
      tone: auth.tone
    };
  });
  if (!cells.some((c) => c.timeframe === "5M")) {
    cells.push({
      timeframe: "5M",
      direction: auth.label,
      label: "Entry confirm",
      tone: auth.tone
    });
  }
  return {
    cells,
    conclusion:
      base?.conclusion ??
      (auth.supportsPlan
        ? "5M confirmation supports the primary plan."
        : auth.meaningful
          ? "5M state does not confirm the primary plan — wait."
          : "5M confirmation still pending.")
  };
}
