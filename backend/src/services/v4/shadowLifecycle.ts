import { v4Config } from "./config";
import type { V4Bar } from "./types";
import type { V4LockedShadowPlan, V4ShadowPlanRelation, V4ShadowPlanStatus } from "./shadowTypes";

const LOCKED_FIELDS = [
  "entry",
  "stopLoss",
  "tp1",
  "tp2",
  "tp3",
  "riskDistance",
  "direction",
  "strategyFamily",
  "createdAt",
  "barTime",
  "profileVersion",
  "configVersion"
] as const;

export type LockedField = (typeof LOCKED_FIELDS)[number];

/** Audit + reject any attempt to change immutable plan fields. */
export function assertShadowPlanImmutable(
  plan: V4LockedShadowPlan,
  patch: Partial<V4LockedShadowPlan>
): { ok: true; plan: V4LockedShadowPlan } | { ok: false; attemptedFields: string[]; plan: V4LockedShadowPlan } {
  const attempted: string[] = [];
  for (const field of LOCKED_FIELDS) {
    if (field in patch && patch[field] !== undefined && patch[field] !== plan[field]) {
      attempted.push(field);
    }
  }
  if (attempted.length > 0) {
    return {
      ok: false,
      attemptedFields: attempted,
      plan: { ...plan, mutationAttempts: plan.mutationAttempts + 1, updatedAt: new Date().toISOString() }
    };
  }
  return { ok: true, plan };
}

export function relateToShadowPlan(
  plan: V4LockedShadowPlan,
  bias: string,
  direction: "BUY" | "SELL" | null
): V4ShadowPlanRelation {
  if (!direction) return "NEUTRAL_TO_SHADOW_PLAN";
  if (direction === plan.direction) return "SUPPORTS_SHADOW_PLAN";
  if (bias.includes("BIAS")) return "CONFLICTS_WITH_SHADOW_PLAN";
  return "WEAKENS_SHADOW_PLAN";
}

/**
 * Advance shadow plan with a confirmed bar.
 * Idempotent on eventId. Rejects stale / out-of-order bars.
 * Same-bar SL+TP → AMBIGUOUS_WORST_CASE_SL (SL first).
 */
export function applyBarToShadowPlan(
  plan: V4LockedShadowPlan,
  bar: V4Bar,
  eventId: string
): V4LockedShadowPlan {
  if (plan.appliedBarEventIds.includes(eventId)) {
    return plan; // idempotent
  }

  if (!bar.confirmed) {
    return plan;
  }

  const barTs = Date.parse(bar.time);
  const lastTs = plan.lastBarTime ? Date.parse(plan.lastBarTime) : null;
  if (lastTs != null && Number.isFinite(lastTs) && Number.isFinite(barTs) && barTs < lastTs) {
    // out-of-order — ignore without corrupting
    return plan;
  }

  const createdTs = Date.parse(plan.barTime);
  if (
    Number.isFinite(barTs) &&
    Number.isFinite(createdTs) &&
    barTs - createdTs > v4Config.lifecycle.maxBarSkewMs
  ) {
    return plan; // stale relative to plan creation window policy
  }

  const next: V4LockedShadowPlan = {
    ...plan,
    appliedBarEventIds: [...plan.appliedBarEventIds, eventId].slice(-200),
    lastBarTime: bar.time,
    updatedAt: new Date().toISOString()
  };

  const terminal: V4ShadowPlanStatus[] = [
    "TP1_HIT",
    "TP2_HIT",
    "TP3_HIT",
    "LOSS_SL",
    "EXPIRED",
    "CANCELLED",
    "AMBIGUOUS_WORST_CASE_SL"
  ];
  if (terminal.includes(plan.status)) {
    return next;
  }

  const risk = plan.riskDistance;
  const updateExcursion = (p: V4LockedShadowPlan): V4LockedShadowPlan => {
    if (p.status === "WAITING_FOR_ENTRY" || p.entryTriggeredAt == null) return p;
    const favorable =
      p.direction === "BUY" ? (bar.high - p.entry) / risk : (p.entry - bar.low) / risk;
    const adverse =
      p.direction === "BUY" ? (p.entry - bar.low) / risk : (bar.high - p.entry) / risk;
    return {
      ...p,
      mfe: Math.max(p.mfe ?? 0, Math.round(favorable * 100) / 100),
      mae: Math.max(p.mae ?? 0, Math.round(Math.max(0, adverse) * 100) / 100)
    };
  };

  if (next.status === "WAITING_FOR_ENTRY") {
    const touched =
      next.direction === "BUY"
        ? bar.low <= next.entry && bar.high >= next.entry
        : bar.low <= next.entry && bar.high >= next.entry;
    const barsWait = (next.barsToEntry ?? 0) + 1;
    if (touched) {
      next.status = "ENTERED";
      next.entryTriggeredAt = bar.time;
      next.barsToEntry = barsWait;
      next.barsInTrade = 0;
    } else if (barsWait >= v4Config.lifecycle.entryExpiryBars) {
      next.status = "EXPIRED";
      next.resolvedAt = bar.time;
      next.barsToEntry = barsWait;
      next.grossR = 0;
      next.netR = 0;
      return next;
    } else {
      next.barsToEntry = barsWait;
      return next;
    }
  }

  // In trade
  next.barsInTrade = (next.barsInTrade ?? 0) + 1;
  Object.assign(next, updateExcursion(next));

  const slHit =
    next.direction === "BUY" ? bar.low <= next.stopLoss : bar.high >= next.stopLoss;
  const tp1Hit = next.direction === "BUY" ? bar.high >= next.tp1 : bar.low <= next.tp1;
  const tp2Hit = next.direction === "BUY" ? bar.high >= next.tp2 : bar.low <= next.tp2;
  const tp3Hit = next.direction === "BUY" ? bar.high >= next.tp3 : bar.low <= next.tp3;

  const costR = next.costs.totalCostR ?? 0;

  if (slHit && (tp1Hit || tp2Hit || tp3Hit)) {
    next.status = "AMBIGUOUS_WORST_CASE_SL";
    next.resolvedAt = bar.time;
    next.grossR = -1;
    next.netR = Math.round((-1 - costR) * 100) / 100;
    return next;
  }
  if (slHit) {
    next.status = "LOSS_SL";
    next.resolvedAt = bar.time;
    next.grossR = -1;
    next.netR = Math.round((-1 - costR) * 100) / 100;
    return next;
  }
  if (tp3Hit) {
    next.status = "TP3_HIT";
    next.resolvedAt = bar.time;
    next.grossR = 3;
    next.netR = Math.round((3 - costR) * 100) / 100;
    return next;
  }
  if (tp2Hit) {
    next.status = "TP2_HIT";
    next.resolvedAt = bar.time;
    next.grossR = 2;
    next.netR = Math.round((2 - costR) * 100) / 100;
    return next;
  }
  if (tp1Hit) {
    next.status = "TP1_HIT";
    next.resolvedAt = bar.time;
    next.grossR = 1;
    next.netR = Math.round((1 - costR) * 100) / 100;
    return next;
  }

  if ((next.barsInTrade ?? 0) >= v4Config.lifecycle.maxBarsInTrade) {
    next.status = "EXPIRED";
    next.resolvedAt = bar.time;
    next.grossR = 0;
    next.netR = Math.round((0 - costR) * 100) / 100;
  }

  return next;
}
