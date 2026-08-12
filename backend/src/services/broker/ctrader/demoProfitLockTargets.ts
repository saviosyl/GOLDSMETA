/**
 * Strategy target validation for PROFIT_LOCK_V1 entry.
 * Never invents targets. Geometry must be strictly ordered.
 */

export type ProfitLockTargetValidation =
  | { ok: true; tp1: number; tp2: number; tp3: number }
  | {
      ok: false;
      code: "PROFIT_LOCK_TARGETS_INCOMPLETE" | "PROFIT_LOCK_TARGETS_INVALID";
      message: string;
    };

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function validateProfitLockTargets(args: {
  side: "BUY" | "SELL";
  entry: number | null | undefined;
  tp1: number | null | undefined;
  tp2: number | null | undefined;
  tp3: number | null | undefined;
}): ProfitLockTargetValidation {
  if (!finite(args.entry) || !finite(args.tp1) || !finite(args.tp2) || !finite(args.tp3)) {
    return {
      ok: false,
      code: "PROFIT_LOCK_TARGETS_INCOMPLETE",
      message: "PROFIT_LOCK_V1 requires finite strategy TP1, TP2, and TP3"
    };
  }
  const { entry, tp1, tp2, tp3 } = args;
  if (args.side === "BUY") {
    if (!(entry < tp1 && tp1 < tp2 && tp2 < tp3)) {
      return {
        ok: false,
        code: "PROFIT_LOCK_TARGETS_INVALID",
        message: "BUY requires entry < TP1 < TP2 < TP3"
      };
    }
  } else if (!(entry > tp1 && tp1 > tp2 && tp2 > tp3)) {
    return {
      ok: false,
      code: "PROFIT_LOCK_TARGETS_INVALID",
      message: "SELL requires entry > TP1 > TP2 > TP3"
    };
  }
  return { ok: true, tp1, tp2, tp3 };
}

/** Executable close-side price for target touch. Mid is never used. */
export function executableTargetTouchPrice(args: {
  side: "BUY" | "SELL";
  bid: number | null | undefined;
  ask: number | null | undefined;
}): number | null {
  if (args.side === "BUY") {
    return typeof args.bid === "number" && Number.isFinite(args.bid)
      ? args.bid
      : null;
  }
  return typeof args.ask === "number" && Number.isFinite(args.ask)
    ? args.ask
    : null;
}

export function targetTouched(args: {
  side: "BUY" | "SELL";
  touchPrice: number | null;
  level: number | null;
}): boolean {
  if (args.touchPrice == null || args.level == null) return false;
  return args.side === "BUY"
    ? args.touchPrice >= args.level
    : args.touchPrice <= args.level;
}
