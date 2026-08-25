/**
 * Diagnostics-only shadow records for blocked PLAN_15M candidates.
 * Never actionable, never orders, never changes production plan state.
 */

import { randomUUID } from "node:crypto";
import type { GoldMetaStore } from "../storage/types";

export type ShadowPlanCandidate = {
  shadowId: string;
  userId: string;
  createdAt: string;
  sourceDecisionId: string | null;
  planSourceKey: string | null;
  direction: "BUY" | "SELL" | "WAIT" | null;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  riskDistance: number | null;
  rewardDistance: number | null;
  riskReward: number | null;
  blockingReasons: string[];
  softLimitations: string[];
  dataCompleteness: {
    hasDirection: boolean;
    hasEntry: boolean;
    hasStop: boolean;
    hasTp1: boolean;
    hasTp2: boolean;
    hasProfile: boolean;
    hasFourHour: boolean;
  };
  session: string | null;
  marketRegime: string | null;
  marketStructureMode: string | null;
  scriptVersion: string | null;
  schemaVersion: string | null;
  alertRole: string | null;
  diagnosticsOnly: true;
  actionable: false;
  orderSubmission: false;
};

export const buildShadowPlanCandidate = (args: {
  userId: string;
  sourceDecisionId?: string | null;
  planSourceKey?: string | null;
  direction?: string | null;
  entry?: number | null;
  stop?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  riskDistance?: number | null;
  rewardDistance?: number | null;
  riskReward?: number | null;
  blockingReasons?: string[];
  softLimitations?: string[];
  session?: string | null;
  marketRegime?: string | null;
  marketStructureMode?: string | null;
  scriptVersion?: string | null;
  schemaVersion?: string | null;
  alertRole?: string | null;
  hasProfile?: boolean;
  hasFourHour?: boolean;
}): ShadowPlanCandidate => {
  const directionRaw = String(args.direction ?? "").toUpperCase();
  const direction =
    directionRaw === "BUY" || directionRaw === "SELL" || directionRaw === "WAIT"
      ? directionRaw
      : null;
  return {
    shadowId: `shadow_${randomUUID()}`,
    userId: args.userId,
    createdAt: new Date().toISOString(),
    sourceDecisionId: args.sourceDecisionId ?? null,
    planSourceKey: args.planSourceKey ?? null,
    direction,
    entry: args.entry ?? null,
    stop: args.stop ?? null,
    tp1: args.tp1 ?? null,
    tp2: args.tp2 ?? null,
    riskDistance: args.riskDistance ?? null,
    rewardDistance: args.rewardDistance ?? null,
    riskReward: args.riskReward ?? null,
    blockingReasons: args.blockingReasons ?? [],
    softLimitations: args.softLimitations ?? [],
    dataCompleteness: {
      hasDirection: direction === "BUY" || direction === "SELL",
      hasEntry: args.entry != null,
      hasStop: args.stop != null,
      hasTp1: args.tp1 != null,
      hasTp2: args.tp2 != null,
      hasProfile: Boolean(args.hasProfile),
      hasFourHour: Boolean(args.hasFourHour)
    },
    session: args.session ?? null,
    marketRegime: args.marketRegime ?? null,
    marketStructureMode: args.marketStructureMode ?? null,
    scriptVersion: args.scriptVersion ?? null,
    schemaVersion: args.schemaVersion ?? null,
    alertRole: args.alertRole ?? null,
    diagnosticsOnly: true,
    actionable: false,
    orderSubmission: false
  };
};

export const persistShadowPlanCandidate = async (
  store: GoldMetaStore,
  candidate: ShadowPlanCandidate
): Promise<void> => {
  if (typeof store.saveShadowPlanCandidate === "function") {
    await store.saveShadowPlanCandidate(candidate.userId, candidate);
  }
};
