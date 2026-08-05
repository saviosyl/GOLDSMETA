/**
 * Owner/admin PLAN_15M opportunity funnel — diagnostics only.
 */

import type { GoldMetaStore } from "../storage/types";
import type { SessionPlanRecord } from "./sessionPlanTypes";
import type { ShadowPlanCandidate } from "./shadowPlanCandidate";

export type PlanOpportunityFunnel = {
  signalsReceived: number;
  directionalCandidates: number;
  validGeometry: number;
  adequateTp1Room: number;
  waitingForEntryZone: number;
  waitingFor5mConfirmation: number;
  confirmed: number;
  blocked: number;
  expired: number;
  topBlockingReasons: Array<{ reason: string; count: number }>;
  diagnosticsOnly: true;
};

const bump = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};

export const buildPlanOpportunityFunnel = (args: {
  activePlan: SessionPlanRecord | null | undefined;
  shadows: ShadowPlanCandidate[];
  recentDecisions?: Array<{ decision?: string | null }>;
}): PlanOpportunityFunnel => {
  const reasons: Record<string, number> = {};
  let signalsReceived = args.recentDecisions?.length ?? 0;
  let directionalCandidates = 0;
  let validGeometry = 0;
  let adequateTp1Room = 0;
  let waitingForEntryZone = 0;
  let waitingFor5mConfirmation = 0;
  let confirmed = 0;
  let blocked = 0;
  let expired = 0;

  for (const d of args.recentDecisions ?? []) {
    if (d.decision === "BUY" || d.decision === "SELL") directionalCandidates += 1;
  }

  const plan = args.activePlan;
  if (plan) {
    signalsReceived = Math.max(signalsReceived, 1);
    if (plan.direction === "BUY" || plan.direction === "SELL") {
      directionalCandidates = Math.max(directionalCandidates, 1);
    }
    if (plan.geometryValid !== false && plan.entry && plan.stopLoss) {
      validGeometry += 1;
      if ((plan.quickTarget?.roomOk ?? true) || plan.takeProfits.some((t) => t.label === "TP1")) {
        adequateTp1Room += 1;
      }
    }
    if (plan.lifecycleState === "WAITING_FOR_ENTRY_ZONE" || plan.lifecycleState === "ARMED") {
      waitingForEntryZone += 1;
    }
    if (
      plan.planQuality?.reasons?.includes("AWAITING_5M_CONFIRMATION") ||
      plan.lifecycleState === "WAITING_FOR_ENTRY_ZONE"
    ) {
      waitingFor5mConfirmation += 1;
    }
    if (plan.lifecycleState === "CONFIRMED" || plan.lifecycleState === "IN_PROGRESS") {
      confirmed += 1;
    }
    if (plan.lifecycleState === "NO_VALID_PLAN" || plan.lifecycleState === "NO_TRADE") {
      blocked += 1;
      for (const r of plan.geometryReasonCodes ?? plan.planQuality?.reasons ?? []) {
        bump(reasons, r);
      }
    }
    if (plan.lifecycleState === "EXPIRED" || plan.lifecycleState === "INVALIDATED") {
      expired += 1;
    }
  }

  for (const s of args.shadows) {
    blocked += 1;
    signalsReceived += 1;
    if (s.direction === "BUY" || s.direction === "SELL") directionalCandidates += 1;
    for (const r of s.blockingReasons) bump(reasons, r);
  }

  const topBlockingReasons = Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([reason, count]) => ({ reason, count }));

  return {
    signalsReceived,
    directionalCandidates,
    validGeometry,
    adequateTp1Room,
    waitingForEntryZone,
    waitingFor5mConfirmation,
    confirmed,
    blocked,
    expired,
    topBlockingReasons,
    diagnosticsOnly: true
  };
};

export const loadPlanOpportunityFunnel = async (
  store: GoldMetaStore,
  userId: string
): Promise<PlanOpportunityFunnel> => {
  const [active, shadows, decisions] = await Promise.all([
    store.getActiveSessionPlan?.(userId) ?? Promise.resolve(undefined),
    store.listShadowPlanCandidates?.(userId, 50) ?? Promise.resolve([]),
    store.listDecisions(userId, 40)
  ]);
  return buildPlanOpportunityFunnel({
    activePlan: active,
    shadows,
    recentDecisions: decisions.map((d) => ({
      decision: d.decision
    }))
  });
};
