import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import { useShellQuote } from "../lib/quoteContext";
import { applyStablePlanToIntraday, type StablePlanSummary } from "../lib/sessionPlanBridge";
import { resolveDisplayAction } from "../lib/planDisplay";
import type { IntradayPlan } from "../types/intradayPlan";
import type { Decision } from "../types/models";

type MarketStructureDiagnostics = {
  quoteSource?: string | null;
  signalSource?: string | null;
  quoteTimeframe?: string | null;
  structureTimeframe?: string | null;
  confirmationTimeframe?: string | null;
  signalAgeSeconds?: number | null;
  quoteAgeSeconds?: number | null;
  confirmationAgeSeconds?: number | null;
  validityStatus?: string | null;
  rejectionReasons?: string[];
};

type LatestPack = {
  decision?: Decision | null;
  latestQuote?: Decision | null;
  latestCompleteStrategySignal?: Decision | null;
  latestConfirmation?: Decision | null;
  intradayPlan?: IntradayPlan | null;
  stablePlan?: StablePlanSummary | null;
  sessionPlan?: StablePlanSummary | null;
  marketStructureMode?: string | null;
  marketStructureDiagnostics?: MarketStructureDiagnostics | null;
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

function prettyDirection(raw: string | null | undefined): string {
  if (!raw) return "Neutral";
  return String(raw)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function biasLabel(plan: IntradayPlan | null, decision: Decision | null): string {
  return prettyDirection(plan?.directionBias ?? decision?.higherTimeframeBias ?? decision?.marketStructure?.trend ?? null);
}

function decisionPrice(decision: Decision | null): number | null {
  const value = decision?.lastKnownPrice ?? decision?.ohlcv?.close ?? null;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function isConfirmedShortTermStatus(status: string | null | undefined): boolean {
  return ["CONFIRMED", "IN_PROGRESS", "TP1_REACHED", "TP2_REACHED"].includes(String(status ?? "").toUpperCase());
}

export function useGoldMetaMarketView() {
  const { api } = useAuth();
  const { quote } = useShellQuote();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [analysisQuote, setAnalysisQuote] = useState<Decision | null>(null);
  const [structureDecision, setStructureDecision] = useState<Decision | null>(null);
  const [confirmationDecision, setConfirmationDecision] = useState<Decision | null>(null);
  const [stablePlan, setStablePlan] = useState<StablePlanSummary | null>(null);
  const [diagnostics, setDiagnostics] = useState<MarketStructureDiagnostics | null>(null);
  const [plan, setPlan] = useState<IntradayPlan | null>(null);
  const [marketStructureMode, setMarketStructureMode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const raw = (await api.latestDecisionPack()) as LatestPack;
      const stable = raw.stablePlan ?? raw.sessionPlan ?? null;
      setDecision(raw.decision ?? null);
      setAnalysisQuote(raw.latestQuote ?? raw.decision ?? null);
      setStructureDecision(raw.latestCompleteStrategySignal ?? null);
      setConfirmationDecision(raw.latestConfirmation ?? null);
      setStablePlan(stable);
      setDiagnostics(raw.marketStructureDiagnostics ?? null);
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

  // Analysis pages stay on the TradingView price basis that created the strategy structure.
  // The shared cTrader quote is an execution/feed-health fallback only; it must not silently
  // replace the TradingView price while POC/VAH/VAL still come from TradingView.
  const livePrice = decisionPrice(analysisQuote) ?? decisionPrice(structureDecision) ?? quote?.price ?? null;
  const canonicalDecision = structureDecision ?? decision;
  const action = actionFromPlan(plan, canonicalDecision);
  const confidence = plan?.confidence ?? canonicalDecision?.confidence ?? null;
  const direction = biasLabel(plan, canonicalDecision);
  // Day Trade uses the backend-published 1H bias. 4H remains context only in timeframeAlignment.
  const dayTradeDirection = prettyDirection(stablePlan?.higherTimeframeBias ?? canonicalDecision?.higherTimeframeBias ?? null);
  const structure = marketStructureMode === "COMPLETE" ? structureDecision?.marketStructure ?? null : null;
  const support = marketStructureMode === "COMPLETE" ? plan?.zones?.nearestSupport ?? null : null;
  const resistance = marketStructureMode === "COMPLETE" ? plan?.zones?.nearestResistance ?? null : null;
  const marketClosed = quote?.freshness === "MARKET_CLOSED" || quote?.marketStatus === "CLOSED";
  const session = plan?.session ?? canonicalDecision?.currentSession ?? quote?.sessionLabel ?? "Session unavailable";
  const explanation =
    plan?.oneSentence ??
    canonicalDecision?.explanation ??
    (action === "WAIT"
      ? "GoldMeta is waiting for a verified setup before showing a directional trade."
      : `${action} conditions are currently leading the verified GoldMeta analysis.`);

  const entry = canonicalDecision?.entry?.price ?? null;
  const stop = plan?.tradePlan?.stopLoss ?? canonicalDecision?.stopLoss?.price ?? null;
  const tp1 = plan?.tradePlan?.tp1 ?? canonicalDecision?.takeProfits?.find((t) => t.label === "TP1")?.price ?? null;
  const tp2 = plan?.tradePlan?.tp2 ?? canonicalDecision?.takeProfits?.find((t) => t.label === "TP2")?.price ?? null;
  const tp3 = plan?.tradePlan?.tp3 ?? canonicalDecision?.takeProfits?.find((t) => t.label === "TP3")?.price ?? null;

  const tradeGeometry = useMemo(
    () => ({
      entry,
      entryLabel: plan?.tradePlan?.entryZone ?? (entry != null ? entry.toFixed(2) : null),
      stop,
      tp1,
      tp2,
      tp3,
      riskReward: plan?.tradePlan?.riskReward ?? null,
      invalidation: plan?.tradePlan?.invalidation ?? plan?.invalidation ?? canonicalDecision?.invalidation ?? null,
      management: plan?.tradePlan?.management ?? canonicalDecision?.recommendedManagementAction ?? null,
      actionable: marketStructureMode === "COMPLETE" && Boolean(plan?.tradePlan?.actionable),
      direction: plan?.tradePlan?.direction ?? (action === "WAIT" ? "NONE" : action)
    }),
    [entry, stop, tp1, tp2, tp3, plan, canonicalDecision, action, marketStructureMode]
  );

  const shortTermActionable = tradeGeometry.actionable && isConfirmedShortTermStatus(plan?.planStatus);
  const shortTermAction: "BUY" | "SELL" | "WAIT" =
    shortTermActionable && (tradeGeometry.direction === "BUY" || tradeGeometry.direction === "SELL")
      ? tradeGeometry.direction
      : "WAIT";

  const analysisPriceSource = analysisQuote?.priceSources?.alertClose?.source ?? diagnostics?.quoteSource ?? "TRADINGVIEW_ANALYSIS";
  const structureSource = structureDecision?.priceSources?.poc?.source ?? diagnostics?.signalSource ?? null;

  return {
    decision: canonicalDecision,
    latestDecision: decision,
    analysisQuote,
    structureDecision,
    confirmationDecision,
    stablePlan,
    diagnostics,
    plan,
    marketStructureMode,
    loading,
    refreshing,
    error,
    refresh: () => load(true),
    livePrice,
    analysisPriceSource,
    structureSource,
    structureTimeframe: diagnostics?.structureTimeframe ?? structureDecision?.timeframe ?? null,
    quoteTimeframe: diagnostics?.quoteTimeframe ?? analysisQuote?.timeframe ?? null,
    confirmationTimeframe: diagnostics?.confirmationTimeframe ?? confirmationDecision?.timeframe ?? null,
    action,
    shortTermAction,
    shortTermActionable,
    confidence,
    direction,
    dayTradeDirection,
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
