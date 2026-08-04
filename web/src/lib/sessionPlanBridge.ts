/**
 * Bridge backend sessionPlan / stablePlan into IntradayPlan optional Pine3 fields.
 * Safe when backend fields are absent — returns plan unchanged.
 */

import type {
  Confirmation5M,
  IntradayPlan,
  StablePlanStatus,
  TimeframeAlignment
} from "../types/intradayPlan";

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
};

function mapConfirmation(state: string | null | undefined): Confirmation5M | null {
  if (!state) return null;
  const s = state.toUpperCase();
  const quiet = ["NONE", "OUTSIDE_ZONE", "INSIDE_ZONE", "APPROACHING_ZONE"];
  const meaningful = !quiet.includes(s);
  return {
    state: s,
    label: s.replace(/_/g, " "),
    meaningful,
    detail: meaningful
      ? `5M confirmation state: ${s.replace(/_/g, " ")}`
      : "No meaningful 5-minute confirmation state change."
  };
}

function mapAlignment(plan: IntradayPlan, stable: StablePlanSummary): TimeframeAlignment {
  const ctx = stable.fourHourContext;
  const bias = stable.higherTimeframeBias ?? ctx?.direction ?? plan.directionBias;
  const biasTone =
    String(bias).toUpperCase().includes("BULL")
      ? "buy"
      : String(bias).toUpperCase().includes("BEAR")
        ? "sell"
        : "wait";
  const conf = stable.confirmationState?.toUpperCase() ?? "";
  const confTone = conf.includes("BREAKOUT") || conf.includes("HELD")
    ? "buy"
    : conf.includes("REJECTION") || conf.includes("FAILED")
      ? "sell"
      : conf
        ? "wait"
        : "unavailable";

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
        direction: stable.confirmationState?.replace(/_/g, " ") ?? "Pending",
        label: "Entry confirm",
        tone: confTone
      }
    ],
    conclusion:
      stable.planStabilityLabel === "PLAN UNCHANGED"
        ? "Plan unchanged — quote refreshed price and distances only."
        : stable.lifecycleState === "CONFIRMED"
          ? "Session plan is confirmed — manage risk manually; AutoTrade stays OFF."
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
  if (!stable) return plan;

  const confirmation5m =
    mapConfirmation(stable.confirmationState) ?? plan.confirmation5m ?? null;
  const planStatus = (stable.lifecycleState as StablePlanStatus | null) ?? plan.planStatus ?? null;
  const planUnchanged =
    stable.planStabilityLabel === "PLAN UNCHANGED" ||
    stable.planMutation === "PLAN_UNCHANGED" ||
    plan.planUnchanged === true;

  const tp1 =
    stable.quickTarget?.tp1 ??
    stable.takeProfits?.find((t) => t.label === "TP1")?.price ??
    null;

  const nextTradePlan =
    plan.tradePlan.cardKind === "ACTIVE_PLAN" || !stable.entry
      ? plan.tradePlan
      : {
          ...plan.tradePlan,
          entryZone:
            plan.tradePlan.entryZone ??
            (stable.entry.price != null ? String(stable.entry.price) : plan.tradePlan.entryZone),
          stopLoss: plan.tradePlan.stopLoss ?? stable.stopLoss?.price ?? null,
          tp1: plan.tradePlan.tp1 ?? tp1
        };

  return {
    ...plan,
    planStatus,
    planUnchanged,
    planSourceKey: stable.planSourceKey ?? plan.planSourceKey ?? null,
    confirmation5m,
    timeframeAlignment: plan.timeframeAlignment ?? mapAlignment(plan, stable),
    tradePlan: nextTradePlan,
    planQuality: stable.planQuality ?? (plan as IntradayPlan & { planQuality?: StablePlanSummary["planQuality"] }).planQuality ?? null,
    freshness: {
      ...plan.freshness,
      quoteAgeSeconds: stable.quoteAgeSeconds ?? plan.freshness.quoteAgeSeconds,
      signalAgeSeconds: stable.signalAgeSeconds ?? plan.freshness.signalAgeSeconds
    }
  } as IntradayPlan;
}
