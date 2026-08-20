/**
 * Bridge backend sessionPlan / stablePlan into IntradayPlan optional Pine3 fields.
 * Safe when backend fields are absent — returns plan unchanged.
 * Applies authoritative 5M confirmation + geometry safety for display.
 */

import type {
  Confirmation5M,
  IntradayPlan,
  StablePlanStatus,
  TimeframeAlignment
} from "../types/intradayPlan";
import {
  alignTimeframesWithConfirmation,
  resolveAuthoritativeConfirmation,
  toConfirmation5m
} from "./confirmationAuthority";

export type StablePlanSummary = {
  planId?: string | null;
  planSourceKey?: string | null;
  lifecycleState?: string | null;
  planMutation?: string | null;
  planStabilityLabel?: string | null;
  direction?: string | null;
  entry?: { price?: number | null; zoneLow?: number | null; zoneHigh?: number | null } | null;
  stopLoss?: { price?: number | null } | null;
  takeProfits?: Array<{ label?: string; price?: number | null }> | null;
  confirmationState?: string | null;
  currentPrice?: number | null;
  distanceToEntryPoints?: number | null;
  distanceToStopPoints?: number | null;
  distanceToTp1Points?: number | null;
  fourHourContext?: {
    direction?: string | null;
    structureState?: string | null;
    strength?: number | null;
  } | null;
  higherTimeframeBias?: string | null;
  quoteAgeSeconds?: number | null;
  signalAgeSeconds?: number | null;
  planQuality?: { grade?: string | null; reasons?: string[] } | null;
  quickTarget?: {
    tp1?: number | null;
    tp1Label?: string | null;
    tp1Reason?: string | null;
  } | null;
  geometryValid?: boolean | null;
  geometryReasonCodes?: string[] | null;
  geometryMessage?: string | null;
};

function mapAlignment(plan: IntradayPlan, stable: StablePlanSummary, confLabel: string, confTone: string): TimeframeAlignment {
  const ctx = stable.fourHourContext;
  const bias = stable.higherTimeframeBias ?? ctx?.direction ?? plan.directionBias;
  const biasTone =
    String(bias).toUpperCase().includes("BULL")
      ? "buy"
      : String(bias).toUpperCase().includes("BEAR")
        ? "sell"
        : "wait";

  return {
    cells: [
      {
        timeframe: "4H",
        direction: ctx?.direction ?? String(bias),
        structure: ctx?.structureState ?? null,
        label: "Wider context",
        tone: biasTone === "wait" ? "info" : biasTone
      },
      {
        timeframe: "1H",
        direction: String(bias),
        label: "Main bias",
        tone: biasTone
      },
      {
        timeframe: "15M",
        direction: plan.actionLabel,
        structure: plan.marketType,
        label: "Plan structure",
        tone: plan.action.startsWith("BUY")
          ? "buy"
          : plan.action.startsWith("SELL")
            ? "sell"
            : plan.action === "NO_TRADE"
              ? "notrade"
              : "wait"
      },
      {
        timeframe: "5M",
        direction: confLabel,
        label: "Entry confirm",
        tone: confTone as TimeframeAlignment["cells"][number]["tone"]
      }
    ],
    conclusion:
      stable.planStabilityLabel === "PLAN UNCHANGED"
        ? "Plan unchanged — quote refreshed price and distances only."
        : stable.lifecycleState === "CONFIRMED"
          ? "Session plan is confirmed — manage risk manually; Gold Hunter Demo stays OFF."
          : stable.lifecycleState === "NO_TRADE" || stable.lifecycleState === "NO_VALID_PLAN"
            ? "No valid session plan — stay flat until a complete 15M plan arrives."
            : `Session plan status: ${String(stable.lifecycleState ?? "unknown").replace(/_/g, " ")}.`
  };
}

/** Enrich IntradayPlan with optional session/stable plan fields from the API pack. */
export function applyStablePlanToIntraday(
  plan: IntradayPlan | null | undefined,
  stable: StablePlanSummary | null | undefined
): IntradayPlan | null {
  if (!plan) return null;
  if (!stable) {
    // Still normalize confirmation authority from plan-local fields.
    const auth = resolveAuthoritativeConfirmation({
      confirmationState: plan.confirmation5m?.state,
      direction: plan.tradePlan.direction || plan.action
    });
    const confirmation5m = toConfirmation5m(auth);
    return {
      ...plan,
      confirmation5m,
      timeframeAlignment: alignTimeframesWithConfirmation(
        plan,
        auth,
        plan.timeframeAlignment
      )
    };
  }

  const planStatus = (stable.lifecycleState as StablePlanStatus | null) ?? plan.planStatus ?? null;
  const planUnchanged =
    stable.planStabilityLabel === "PLAN UNCHANGED" ||
    stable.planMutation === "PLAN_UNCHANGED" ||
    plan.planUnchanged === true;

  const grade = String(stable.planQuality?.grade ?? plan.planQuality?.grade ?? "").toUpperCase();
  const qualityReasons = stable.planQuality?.reasons ?? plan.planQuality?.reasons ?? [];
  const failedGeometry =
    stable.geometryValid === false ||
    plan.geometryValid === false ||
    planStatus === "NO_VALID_PLAN" ||
    grade === "C" ||
    grade === "NO_PLAN" ||
    qualityReasons.some((r) =>
      /STRUCTURE_ONLY|TRADE_LEVELS_FAILED|WAIT_NO_VALID|ENTRY_EQUALS_STOP|STOP_WRONG_SIDE|ZERO_RISK|INVALID_TARGET|MISSING_REQUIRED|PRICE_ALREADY/i.test(
        r
      )
    );

  // geometryValid===undefined means legacy payload — do not invent a failure.
  const geometryValid = failedGeometry
    ? false
    : stable.geometryValid === true || plan.geometryValid === true
      ? true
      : plan.geometryValid ?? null;

  const auth = resolveAuthoritativeConfirmation({
    confirmationState: stable.confirmationState ?? plan.confirmation5m?.state,
    direction: stable.direction ?? plan.tradePlan.direction ?? plan.action
  });
  const confirmation5m: Confirmation5M = toConfirmation5m(auth);

  const tp1 = !failedGeometry
    ? stable.quickTarget?.tp1 ??
      stable.takeProfits?.find((t) => t.label === "TP1")?.price ??
      null
    : null;

  const nextTradePlan = failedGeometry
    ? {
        ...plan.tradePlan,
        cardKind: "NONE" as const,
        actionable: false,
        orderingValid: false,
        orderingNote: stable.geometryMessage ?? "Trade levels failed safety validation.",
        direction: "NONE" as const,
        entryZone: null,
        stopLoss: null,
        tp1: null,
        tp2: null,
        tp3: null
      }
    : plan.tradePlan.cardKind === "ACTIVE_PLAN" || !stable.entry
      ? plan.tradePlan
      : {
          ...plan.tradePlan,
          entryZone:
            plan.tradePlan.entryZone ??
            (stable.entry.price != null ? String(stable.entry.price) : plan.tradePlan.entryZone),
          stopLoss: plan.tradePlan.stopLoss ?? stable.stopLoss?.price ?? null,
          tp1: plan.tradePlan.tp1 ?? tp1
        };

  const baseAlignment = mapAlignment(plan, stable, auth.label, auth.tone);
  const timeframeAlignment = alignTimeframesWithConfirmation(plan, auth, baseAlignment);

  return {
    ...plan,
    action: failedGeometry ? "PREPARE" : plan.action,
    actionLabel: failedGeometry ? "WAIT" : plan.actionLabel,
    planStatus,
    planUnchanged,
    planSourceKey: stable.planSourceKey ?? plan.planSourceKey ?? null,
    confirmation5m,
    timeframeAlignment,
    tradePlan: nextTradePlan,
    planQuality: stable.planQuality ?? plan.planQuality ?? null,
    geometryValid,
    geometryReasonCodes: failedGeometry
      ? stable.geometryReasonCodes ?? plan.geometryReasonCodes ?? []
      : stable.geometryReasonCodes ?? plan.geometryReasonCodes ?? [],
    geometryMessage: failedGeometry
      ? stable.geometryMessage ?? plan.geometryMessage ?? "Trade levels failed safety validation."
      : stable.geometryMessage ?? plan.geometryMessage ?? null,
    invalidation: failedGeometry
      ? stable.geometryMessage ?? "Trade levels failed safety validation."
      : plan.invalidation,
    freshness: {
      ...plan.freshness,
      quoteAgeSeconds: stable.quoteAgeSeconds ?? plan.freshness.quoteAgeSeconds,
      signalAgeSeconds: stable.signalAgeSeconds ?? plan.freshness.signalAgeSeconds
    }
  };
}
