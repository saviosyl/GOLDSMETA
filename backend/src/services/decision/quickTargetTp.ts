/**
 * Quick-target day-trade mode: TP1 from nearest structural level with room + RR validation.
 */

import type { DecisionDirection, DecisionRecord, MarketSnapshot } from "../../models/types";
import { isPositivePrice, roundPrice, roundRatio } from "../../utils/money";
import type { QuickTargetDayTrade } from "./sessionPlanTypes";
import { EMPTY_QUICK_TARGET } from "./sessionPlanTypes";

/** Minimum points of room to the structural target (XAUUSD). */
export const MIN_ROOM_POINTS = 1.5;
/** Minimum R:R for quick-target TP1 acceptance. */
export const MIN_QUICK_TARGET_RR = 1.0;

const positive = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;

const collectStructuralLevels = (
  decision: DecisionRecord | null,
  snapshot: MarketSnapshot | null
): Array<{ price: number; label: string }> => {
  const out: Array<{ price: number; label: string }> = [];
  const push = (price: number | null | undefined, label: string) => {
    if (isPositivePrice(price)) out.push({ price, label });
  };

  if (decision?.marketStructure) {
    push(decision.marketStructure.poc, "POC");
    push(decision.marketStructure.vah, "VAH");
    push(decision.marketStructure.val, "VAL");
  }
  if (snapshot) {
    push(snapshot.levels?.pocAll, "POC");
    push(snapshot.levels?.vahAll, "VAH");
    push(snapshot.levels?.valAll, "VAL");
    push(snapshot.sessionVolumeProfile?.poc, "session POC");
    push(snapshot.sessionVolumeProfile?.vah, "session VAH");
    push(snapshot.sessionVolumeProfile?.val, "session VAL");
    for (const h of snapshot.sessionVolumeProfile?.hvn ?? []) push(h, "HVN");
    for (const l of snapshot.sessionVolumeProfile?.lvn ?? []) push(l, "LVN");
    push(snapshot.marketProfile?.initialBalanceHigh, "IB high");
    push(snapshot.marketProfile?.initialBalanceLow, "IB low");
  }

  // Dedupe by rounded price.
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = item.price.toFixed(2);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const collectFromOptional = (
  optional: Record<string, unknown> | null | undefined
): Array<{ price: number; label: string }> => {
  if (!optional) return [];
  const out: Array<{ price: number; label: string }> = [];
  const push = (price: unknown, label: string) => {
    if (typeof price === "number" && isPositivePrice(price)) out.push({ price, label });
  };

  const day = optional.dayLevels as Record<string, unknown> | undefined;
  if (day) {
    push(day.previousDayHigh, "prev day high");
    push(day.previousDayLow, "prev day low");
    push(day.currentDayHigh, "day high");
    push(day.currentDayLow, "day low");
  }
  const opening = optional.openingRange as Record<string, unknown> | undefined;
  if (opening) {
    push(opening.high, "opening range high");
    push(opening.low, "opening range low");
  }
  const structure = optional.structure as Record<string, unknown> | undefined;
  if (structure) {
    push(structure.lastSwingHigh, "swing high");
    push(structure.lastSwingLow, "swing low");
  }
  const sr = optional.supportResistance as { support?: unknown[]; resistance?: unknown[] } | undefined;
  for (const p of sr?.support ?? []) push(p, "support");
  for (const p of sr?.resistance ?? []) push(p, "resistance");
  return out;
};

export const selectQuickTargetTp1 = (args: {
  direction: DecisionDirection | null;
  entry: number | null;
  stop: number | null;
  decision: DecisionRecord | null;
  snapshot?: MarketSnapshot | null;
  optionalIndicators?: Record<string, unknown> | null;
}): QuickTargetDayTrade => {
  const empty = EMPTY_QUICK_TARGET();
  const direction = args.direction;
  const entry = positive(args.entry);
  const stop = positive(args.stop);

  if (!direction || direction === "WAIT" || entry == null || stop == null) {
    return { ...empty, tp1Reason: "Need direction, entry, and stop for quick-target TP1" };
  }

  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) {
    return { ...empty, tp1Reason: "Invalid risk (entry equals stop)" };
  }

  const levels = [
    ...collectStructuralLevels(args.decision, args.snapshot ?? null),
    ...collectFromOptional(args.optionalIndicators)
  ];

  const candidates =
    direction === "BUY"
      ? levels
          .filter((l) => l.price > entry + MIN_ROOM_POINTS * 0.25)
          .sort((a, b) => a.price - b.price)
      : levels
          .filter((l) => l.price < entry - MIN_ROOM_POINTS * 0.25)
          .sort((a, b) => b.price - a.price);

  for (const candidate of candidates) {
    const room = Math.abs(candidate.price - entry);
    const rr = room / risk;
    const roomOk = room >= MIN_ROOM_POINTS;
    const rrOk = rr >= MIN_QUICK_TARGET_RR;
    if (roomOk && rrOk) {
      return {
        enabled: true,
        tp1: roundPrice(candidate.price),
        tp1Label: "TP1",
        tp1Reason: `Nearest structural ${candidate.label} with room ${roundPrice(room)} pts and R:R ${roundRatio(rr)}`,
        roomPoints: roundPrice(room),
        roomOk: true,
        riskReward: roundRatio(rr),
        rrOk: true,
        structuralLevelUsed: roundPrice(candidate.price)
      };
    }
  }

  // Fallback: nearest level even if RR/room weak — report validation failure.
  const nearest = candidates[0];
  if (nearest) {
    const room = Math.abs(nearest.price - entry);
    const rr = room / risk;
    return {
      enabled: true,
      tp1: roundPrice(nearest.price),
      tp1Label: "TP1",
      tp1Reason: `Nearest structural ${nearest.label} failed room/RR validation (room=${roundPrice(room)}, R:R=${roundRatio(rr)})`,
      roomPoints: roundPrice(room),
      roomOk: room >= MIN_ROOM_POINTS,
      riskReward: roundRatio(rr),
      rrOk: rr >= MIN_QUICK_TARGET_RR,
      structuralLevelUsed: roundPrice(nearest.price)
    };
  }

  return {
    ...empty,
    tp1Reason: "No structural level found beyond entry for quick-target TP1"
  };
};
