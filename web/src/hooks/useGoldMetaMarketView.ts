import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import { useShellQuote } from "../lib/quoteContext";
import { applyStablePlanToIntraday } from "../lib/sessionPlanBridge";
import { resolveDisplayAction } from "../lib/planDisplay";
import type { IntradayPlan } from "../types/intradayPlan";
import type { Decision } from "../types/models";

type LatestPack = {
  decision?: Decision | null;
  latestQuote?: Decision | null;
  latestCompleteStrategySignal?: Decision | null;
  intradayPlan?: IntradayPlan | null;
  stablePlan?: unknown;
  sessionPlan?: unknown;
  marketStructureMode?: string | null;
  marketStructureDiagnostics?: unknown;
  structureDecisionId?: string | null;
};

function actionFromPlan(plan: IntradayPlan | null, decision: Decision | null): "BUY" | "SELL" | "WAIT" {
  if (plan) {
    const short = resolveDisplayAction(plan).shortLabel.toUpperCase();
    if (short.startsWith("BUY")) return "BUY";
    if (short.startsWith("SELL")) return "SELL";
    return "WAIT";
  }
  if (decision?.decision === "BUY" || decision?.decision === "SELL") return decision.decision;
  return "WAIT";
}

function biasLabel(plan: IntradayPlan | null, decision: Decision | null): string {
  const raw = plan?.directionBias ?? decision?.higherTimeframeBias ?? decision?.marketStructure?.trend ?? null;
  if (!raw) return "Neutral";
  return String(raw)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

/**
 * The latest decision is intentionally quote-first on the API, while market structure
 * is sourced from the latest compatible complete strategy signal. Never let a newer
 * quote-only / confirmation event replace the verified 15M POC/VAH/VAL.
 */
function structureDecisionFromPack(raw: LatestPack, quoteDecision: Decision | null): Decision | null {
  const mode = raw.marketStructureMode?.toUpperCase() ?? null;
  if (mode === "MISMATCH" || mode === "LIVE_RANGE_ONLY" || mode === "UNAVAILABLE") {
    return null;
  }
  if (raw.latestCompleteStrategySignal) {
    return raw.latestCompleteStrategySignal;
  }
  // Backward compatibility for older API responses that predate the split fields.
  return mode === "COMPLETE" || mode == null ? quoteDecision : null;
}

export function useGoldMetaMarketView() {
  const { api } = useAuth();
  const { quote } = useShellQuote();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [structureDecision, setStructureDecision] = useState<Decision | null>(null);
  const [plan, setPlan] = useState<IntradayPlan | null>(null);
  const [marketStructureMode, setMarketStructureMode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const raw = (await api.latestDecisionPack()) as LatestPack;
      const stable = (raw.stablePlan ?? raw.sessionPlan ?? null) as Parameters<typeof applyStablePlanToIntraday>[1];
      const quoteDecision = raw.decision ?? raw.latestQuote ?? null;
      setDecision(quoteDecision);
      setStructureDecision(structureDecisionFromPack(raw, quoteDecision));
      setPlan(applyStablePlanToIntraday(raw.intradayPlan ?? null, stable));
      setMarketStructureMode(raw.marketStructureMode ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Market intelligence is temporarily unavailable.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(false), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const livePrice = quote?.price ?? decision?.lastKnownPrice ?? decision?.ohlcv?.close ?? null;
  const action = actionFromPlan(plan, decision);
  const confidence = plan?.confidence ?? structureDecision?.confidence ?? decision?.confidence ?? null;
  const direction = biasLabel(plan, structureDecision ?? decision);
  const structure = structureDecision?.marketStructure ?? null;
  const support = plan?.zones?.nearestSupport ?? null;
  const resistance = plan?.zones?.nearestResistance ?? null;
  const marketClosed = quote?.freshness === "MARKET_CLOSED" || quote?.marketStatus === "CLOSED";
  const session = quote?.sessionLabel ?? plan?.session ?? structureDecision?.currentSession ?? decision?.currentSession ?? "Session unavailable";
  const explanation =
    plan?.oneSentence ??
    structureDecision?.explanation ??
    decision?.explanation ??
    (action === "WAIT"
      ? "GoldMeta is waiting for a verified setup before showing a directional trade."
      : `${action} conditions are currently leading the verified GoldMeta analysis.`);

  const entry = plan?.tradePlan?.entryPrice ?? structureDecision?.entry?.price ?? decision?.entry?.price ?? null;
  const stop = plan?.tradePlan?.stopLoss ?? structureDecision?.stopLoss?.price ?? decision?.stopLoss?.price ?? null;
  const tp1 = plan?.tradePlan?.tp1 ?? structureDecision?.takeProfits?.find((t) => t.label === "TP1")?.price ?? decision?.takeProfits?.find((t) => t.label === "TP1")?.price ?? null;
  const tp2 = plan?.tradePlan?.tp2 ?? structureDecision?.takeProfits?.find((t) => t.label === "TP2")?.price ?? decision?.takeProfits?.find((t) => t.label === "TP2")?.price ?? null;
  const tp3 = plan?.tradePlan?.tp3 ?? structureDecision?.takeProfits?.find((t) => t.label === "TP3")?.price ?? decision?.takeProfits?.find((t) => t.label === "TP3")?.price ?? null;

  const tradeGeometry = useMemo(
    () => ({
      entry,
      entryLabel: plan?.tradePlan?.entryZone ?? (entry != null ? entry.toFixed(2) : null),
      stop,
      tp1,
      tp2,
      tp3,
      riskReward: plan?.tradePlan?.riskReward ?? null,
      invalidation: plan?.tradePlan?.invalidation ?? plan?.invalidation ?? structureDecision?.invalidation ?? decision?.invalidation ?? null,
      management: plan?.tradePlan?.management ?? structureDecision?.recommendedManagementAction ?? decision?.recommendedManagementAction ?? null,
      actionable: Boolean(plan?.tradePlan?.actionable),
      direction: plan?.tradePlan?.direction ?? (action === "WAIT" ? "NONE" : action)
    }),
    [entry, stop, tp1, tp2, tp3, plan, structureDecision, decision, action]
  );

  return {
    decision,
    structureDecision,
    plan,
    marketStructureMode,
    loading,
    refreshing,
    error,
    refresh: () => load(true),
    livePrice,
    action,
    confidence,
    direction,
    explanation,
    support,
    resistance,
    poc: structure?.poc ?? null,
    vah: structure?.vah ?? null,
    val: structure?.val ?? null,
    trendStrength: structure?.trendStrength ?? null,
    marketClosed,
    session,
    quote,
    tradeGeometry
  };
}
