/**
 * Hard validation for take-profit ordering.
 * BUY:  stop < entry < TP1 < TP2 < TP3 (present levels only, contiguous)
 * SELL: stop > entry > TP1 > TP2 > TP3
 */

export type TargetOrderingResult = {
  ok: boolean;
  reasonCodes: string[];
  message: string | null;
};

const eps = 1e-6;

export const validateTargetOrdering = (input: {
  direction: string | null | undefined;
  entry: number | null | undefined;
  stop: number | null | undefined;
  tp1: number | null | undefined;
  tp2?: number | null;
  tp3?: number | null;
}): TargetOrderingResult => {
  const direction = String(input.direction ?? "").toUpperCase();
  const entry = input.entry;
  const stop = input.stop;
  const tp1 = input.tp1;
  const tp2 = input.tp2 ?? null;
  const tp3 = input.tp3 ?? null;
  const reasons: string[] = [];

  if (direction !== "BUY" && direction !== "SELL") {
    return { ok: true, reasonCodes: [], message: null };
  }
  if (entry == null || stop == null || tp1 == null) {
    return { ok: true, reasonCodes: [], message: null };
  }

  if (direction === "BUY") {
    if (!(stop < entry - eps)) reasons.push("STOP_WRONG_SIDE");
    if (!(entry < tp1 - eps)) reasons.push("TP1_WRONG_SIDE");
    if (tp2 != null && !(tp1 < tp2 - eps)) reasons.push("INVALID_TARGET_ORDER");
    if (tp3 != null) {
      if (tp2 == null) reasons.push("INVALID_TARGET_ORDER");
      else if (!(tp2 < tp3 - eps)) reasons.push("INVALID_TARGET_ORDER");
    }
  } else {
    if (!(stop > entry + eps)) reasons.push("STOP_WRONG_SIDE");
    if (!(entry > tp1 + eps)) reasons.push("TP1_WRONG_SIDE");
    if (tp2 != null && !(tp1 > tp2 + eps)) reasons.push("INVALID_TARGET_ORDER");
    if (tp3 != null) {
      if (tp2 == null) reasons.push("INVALID_TARGET_ORDER");
      else if (!(tp2 > tp3 + eps)) reasons.push("INVALID_TARGET_ORDER");
    }
  }

  return {
    ok: reasons.length === 0,
    reasonCodes: [...new Set(reasons)],
    message: reasons.length
      ? "Target ordering is invalid for this direction."
      : null
  };
};
