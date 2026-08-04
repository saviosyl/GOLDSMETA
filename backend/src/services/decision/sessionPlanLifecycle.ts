/**
 * Stable session plan lifecycle for Pine Bridge 3.0.0 (+ 2.1.0 compat).
 *
 * Rules:
 * - PLAN_15M / legacy STRATEGY (complete confirmed) → create/replace plan
 * - CONFIRM_5M → status only; never replace direction/entry/stop/TP
 * - QUOTE_1M / legacy QUOTE → price/distances/freshness only; PLAN UNCHANGED
 * - Missing 15M → NO_VALID_PLAN
 * - MISMATCH / chart role mismatch → NO_TRADE
 * - 4H context never triggers entry
 * - Never places broker orders
 */

import { createHash } from "crypto";
import { decisionConfig } from "../../config/decisionConfig";
import type { DecisionRecord, TradingViewPayload } from "../../models/types";
import { addMsIso, nowIso } from "../../utils/time";
import type { GoldMetaStore } from "../storage/types";
import { logger } from "../logging/logger";
import {
  extractConfirmationState,
  extractFourHourContext,
  extractPlanSourceKey,
  isConfirmAlert,
  isPlanSourceAlert,
  isQuoteAlert,
  metadataBool,
  metadataString,
  resolveAlertRole
} from "./alertRole";
import { evaluatePlanQuality } from "./planQuality";
import { selectQuickTargetTp1 } from "./quickTargetTp";
import {
  EMPTY_PLAN_QUALITY,
  EMPTY_QUICK_TARGET,
  SESSION_PLAN_DISCLAIMER,
  type FourHourContext,
  type PlanMutation,
  type SessionPlanLifecycleState,
  type SessionPlanRecord
} from "./sessionPlanTypes";
import type { MarketStructureMode } from "./strategySignal";
import { isCompleteStrategySignal } from "./strategySignal";

const positive = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;

const dist = (a: number | null, b: number | null): number | null => {
  if (a == null || b == null) return null;
  return Math.round(Math.abs(a - b) * 100) / 100;
};

const ageSeconds = (iso: string | null | undefined, nowMs: number): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 1000));
};

const parseFourHour = (raw: Record<string, unknown> | null): FourHourContext | null => {
  if (!raw) return null;
  const num = (k: string): number | null => {
    const v = raw[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const str = (k: string): string | null => {
    const v = raw[k];
    return typeof v === "string" ? v : null;
  };
  return {
    direction: str("direction"),
    strength: num("strength"),
    structureState: str("structureState"),
    ema21: num("ema21"),
    ema50: num("ema50"),
    ema200: num("ema200"),
    atr: num("atr"),
    swingHigh: num("swingHigh"),
    swingLow: num("swingLow"),
    sourceCloseTime: str("sourceCloseTime"),
    neverTriggersEntry: true
  };
};

const planIdFor = (userId: string, planSourceKey: string | null, barTime: string): string => {
  const material = planSourceKey ?? `${userId}|XAUUSD|${barTime}|PLAN`;
  return createHash("sha256").update(`session-plan|${userId}|${material}`).digest("hex").slice(0, 28);
};

const stabilityLabel = (
  mutation: PlanMutation
): SessionPlanRecord["planStabilityLabel"] => {
  switch (mutation) {
    case "PLAN_UNCHANGED":
      return "PLAN UNCHANGED";
    case "CREATED":
      return "PLAN CREATED";
    case "REPLACED":
      return "PLAN REPLACED";
    case "STATUS_UPDATED":
      return "STATUS UPDATED";
    case "NO_VALID_PLAN":
      return "NO VALID PLAN";
    case "NO_TRADE":
      return "NO TRADE";
    case "INVALIDATED":
      return "INVALIDATED";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return "NO VALID PLAN";
  }
};

const safetyBlock = (): SessionPlanRecord["safety"] => ({
  autoTrade: "OFF",
  demoOrderSubmission: false,
  liveTrading: false,
  analysisOnly: true,
  brokerOrders: "NONE"
});

const emptyNoValidPlan = (
  userId: string,
  payload: TradingViewPayload,
  decision: DecisionRecord,
  mutation: PlanMutation,
  lifecycleState: SessionPlanLifecycleState,
  reasons: string[],
  marketStructureMode: MarketStructureMode | null
): SessionPlanRecord => {
  const now = nowIso();
  return {
    planId: planIdFor(userId, extractPlanSourceKey(payload), payload.barTime),
    planSourceKey: extractPlanSourceKey(payload),
    userId,
    symbol: "XAUUSD",
    schemaVersion: payload.schemaVersion,
    pineScriptVersion: metadataString(payload, "scriptVersion"),
    alertRole: metadataString(payload, "alertRole") ?? resolveAlertRole(payload),
    lifecycleState,
    planMutation: mutation,
    planStabilityLabel: stabilityLabel(mutation),
    direction: null,
    entry: null,
    stopLoss: null,
    takeProfits: [],
    riskReward: { tp1: null, tp2: null, tp3: null },
    confirmationState: extractConfirmationState(payload),
    fourHourContext: parseFourHour(extractFourHourContext(payload)),
    chartMatchesRole: metadataBool(payload, "chartMatchesRole"),
    testMode: metadataBool(payload, "testMode") === true || decision.isTestDecision,
    currentPrice: positive(decision.lastKnownPrice) ?? positive(payload.ohlcv?.close),
    distanceToEntryPoints: null,
    distanceToStopPoints: null,
    distanceToTp1Points: null,
    quoteAgeSeconds: ageSeconds(decision.marketDataTime, Date.now()),
    signalAgeSeconds: null,
    lastQuoteAt: isQuoteAlert(resolveAlertRole(payload)) ? now : null,
    lastPlanAt: null,
    lastConfirmAt: isConfirmAlert(resolveAlertRole(payload)) ? now : null,
    planQuality: { grade: "NO_PLAN", reasons },
    quickTarget: EMPTY_QUICK_TARGET(),
    sourceDecisionId: decision.decisionId,
    marketStructureMode,
    session: decision.currentSession,
    higherTimeframeBias: null,
    invalidation: reasons.join("; "),
    createdAt: now,
    updatedAt: now,
    validUntil: null,
    environment: decision.environment,
    isTestPlan: decision.isTestDecision,
    safety: safetyBlock(),
    disclaimer: SESSION_PLAN_DISCLAIMER
  };
};

const deriveLifecycleFromPrice = (args: {
  previous: SessionPlanLifecycleState;
  direction: DecisionRecord["decision"] | null;
  price: number | null;
  entry: number | null;
  zoneLow: number | null;
  zoneHigh: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  confirmationState: string | null;
  nowMs: number;
  validUntil: string | null;
}): SessionPlanLifecycleState => {
  if (args.validUntil) {
    const until = Date.parse(args.validUntil);
    if (Number.isFinite(until) && until < args.nowMs) return "EXPIRED";
  }

  const { direction, price, entry, stop, tp1, tp2, confirmationState } = args;
  if (!direction || direction === "WAIT" || entry == null || stop == null) {
    return args.previous === "NO_TRADE" ? "NO_TRADE" : "BUILDING";
  }

  // Invalidation: stop breached
  if (price != null) {
    if (direction === "BUY" && price <= stop) return "INVALIDATED";
    if (direction === "SELL" && price >= stop) return "INVALIDATED";
    if (tp2 != null) {
      if (direction === "BUY" && price >= tp2) return "TP2_REACHED";
      if (direction === "SELL" && price <= tp2) return "TP2_REACHED";
    }
    if (tp1 != null) {
      if (direction === "BUY" && price >= tp1) return "TP1_REACHED";
      if (direction === "SELL" && price <= tp1) return "TP1_REACHED";
    }
  }

  const zoneLow = args.zoneLow ?? entry;
  const zoneHigh = args.zoneHigh ?? entry;
  const inZone =
    price != null &&
    price >= Math.min(zoneLow, zoneHigh) - 0.5 &&
    price <= Math.max(zoneLow, zoneHigh) + 0.5;

  const confirmed =
    confirmationState != null &&
    /BREAKOUT_CONFIRMED|REJECTION_CONFIRMED|RETEST_HELD/i.test(confirmationState);

  if (
    price != null &&
    ((direction === "BUY" && price > entry) || (direction === "SELL" && price < entry)) &&
    (confirmed || args.previous === "IN_PROGRESS" || args.previous === "CONFIRMED")
  ) {
    return "IN_PROGRESS";
  }

  if (confirmed || confirmationState === "INSIDE_ZONE") {
    return inZone || confirmed ? "CONFIRMED" : "ARMED";
  }

  if (inZone || confirmationState === "APPROACHING_ZONE") {
    return "ARMED";
  }

  if (
    args.previous === "CONFIRMED" ||
    args.previous === "IN_PROGRESS" ||
    args.previous === "ARMED" ||
    args.previous === "WAITING_FOR_ENTRY_ZONE" ||
    args.previous === "TP1_REACHED" ||
    args.previous === "TP2_REACHED"
  ) {
    // Keep advanced states unless price logic moved them.
    if (args.previous === "TP1_REACHED" || args.previous === "TP2_REACHED") {
      return args.previous;
    }
  }

  return "WAITING_FOR_ENTRY_ZONE";
};

const refreshDistances = (
  plan: SessionPlanRecord,
  price: number | null,
  nowMs: number
): SessionPlanRecord => {
  const entry = positive(plan.entry?.price) ?? positive(plan.entry?.zoneLow);
  const stop = positive(plan.stopLoss?.price);
  const tp1 =
    positive(plan.quickTarget.tp1) ??
    positive(plan.takeProfits.find((t) => t.label === "TP1")?.price);
  return {
    ...plan,
    currentPrice: price ?? plan.currentPrice,
    distanceToEntryPoints: dist(price, entry),
    distanceToStopPoints: dist(price, stop),
    distanceToTp1Points: dist(price, tp1),
    quoteAgeSeconds: ageSeconds(plan.lastQuoteAt ?? plan.updatedAt, nowMs),
    signalAgeSeconds: ageSeconds(plan.lastPlanAt, nowMs),
    updatedAt: nowIso()
  };
};

const buildPlanFromDecision = (args: {
  userId: string;
  payload: TradingViewPayload;
  decision: DecisionRecord;
  existing: SessionPlanRecord | null;
  marketStructureMode: MarketStructureMode;
  mutation: PlanMutation;
}): SessionPlanRecord => {
  const { userId, payload, decision, existing, marketStructureMode, mutation } = args;
  const now = nowIso();
  const nowMs = Date.now();
  const planSourceKey = extractPlanSourceKey(payload);
  const planId =
    existing &&
    planSourceKey &&
    existing.planSourceKey === planSourceKey &&
    mutation !== "REPLACED" &&
    mutation !== "CREATED"
      ? existing.planId
      : planIdFor(userId, planSourceKey, payload.barTime);

  // Prefer existing locked strategy fields unless this is a plan create/replace.
  const lockStrategy = mutation === "STATUS_UPDATED" || mutation === "PLAN_UNCHANGED";
  const direction = lockStrategy ? existing?.direction ?? decision.decision : decision.decision;
  const entry = lockStrategy ? existing?.entry ?? decision.entry : decision.entry;
  const stopLoss = lockStrategy ? existing?.stopLoss ?? decision.stopLoss : decision.stopLoss;
  const takeProfits = lockStrategy
    ? existing?.takeProfits?.length
      ? existing.takeProfits
      : decision.takeProfits
    : decision.takeProfits;
  const riskReward = lockStrategy ? existing?.riskReward ?? decision.riskReward : decision.riskReward;

  const entryPrice = positive(entry?.price) ?? positive(entry?.zoneLow);
  const stopPrice = positive(stopLoss?.price);
  const price = positive(decision.lastKnownPrice) ?? positive(payload.ohlcv?.close);

  const quickTarget =
    lockStrategy && existing?.quickTarget?.tp1 != null
      ? existing.quickTarget
      : selectQuickTargetTp1({
          direction,
          entry: entryPrice,
          stop: stopPrice,
          decision,
          optionalIndicators: payload.optionalIndicators as Record<string, unknown> | null
        });

  // If quick-target found a better validated TP1 on create/replace, prefer it in takeProfits display copy
  // but keep original decision takeProfits as stored strategy levels when present.
  let finalTakeProfits = takeProfits;
  if (!lockStrategy && quickTarget.tp1 != null && quickTarget.rrOk) {
    const hasTp1 = finalTakeProfits.some((t) => t.label === "TP1");
    if (!hasTp1) {
      finalTakeProfits = [
        { label: "TP1", price: quickTarget.tp1, reason: quickTarget.tp1Reason ?? "Quick-target structural TP1" },
        ...finalTakeProfits
      ];
    } else {
      finalTakeProfits = finalTakeProfits.map((t) =>
        t.label === "TP1"
          ? {
              ...t,
              // Keep decision TP1 unless quick-target is nearer structural with room/RR.
              price: quickTarget.tp1!,
              reason: quickTarget.tp1Reason ?? t.reason
            }
          : t
      );
    }
  }

  const confirmationState =
    extractConfirmationState(payload) ?? existing?.confirmationState ?? null;
  const fourHour =
    parseFourHour(extractFourHourContext(payload)) ?? existing?.fourHourContext ?? null;

  const chartMatchesRole = metadataBool(payload, "chartMatchesRole");
  const planQuality = evaluatePlanQuality({
    decision: {
      ...decision,
      decision: direction ?? "WAIT",
      entry: entry ?? decision.entry,
      stopLoss: stopLoss ?? decision.stopLoss,
      takeProfits: finalTakeProfits
    },
    marketStructureMode,
    confirmationState,
    chartMatchesRole,
    quickTargetRrOk: quickTarget.rrOk,
    hasFourHourContext: fourHour != null
  });

  const validUntil =
    existing?.validUntil && lockStrategy
      ? existing.validUntil
      : addMsIso(now, decisionConfig.decisionTtlMs * 2);

  const lifecycleState = deriveLifecycleFromPrice({
    previous: existing?.lifecycleState ?? "BUILDING",
    direction,
    price,
    entry: entryPrice,
    zoneLow: positive(entry?.zoneLow),
    zoneHigh: positive(entry?.zoneHigh),
    stop: stopPrice,
    tp1: positive(quickTarget.tp1) ?? positive(finalTakeProfits.find((t) => t.label === "TP1")?.price),
    tp2: positive(finalTakeProfits.find((t) => t.label === "TP2")?.price),
    confirmationState,
    nowMs,
    validUntil
  });

  const base: SessionPlanRecord = {
    planId,
    planSourceKey: planSourceKey ?? existing?.planSourceKey ?? null,
    userId,
    symbol: "XAUUSD",
    schemaVersion: payload.schemaVersion,
    pineScriptVersion:
      metadataString(payload, "scriptVersion") ?? existing?.pineScriptVersion ?? null,
    alertRole: metadataString(payload, "alertRole") ?? resolveAlertRole(payload),
    lifecycleState,
    planMutation: mutation,
    planStabilityLabel: stabilityLabel(mutation),
    direction,
    entry: entry ?? null,
    stopLoss: stopLoss ?? null,
    takeProfits: finalTakeProfits,
    riskReward,
    confirmationState,
    fourHourContext: fourHour,
    chartMatchesRole,
    testMode: metadataBool(payload, "testMode") === true || decision.isTestDecision,
    currentPrice: price,
    distanceToEntryPoints: dist(price, entryPrice),
    distanceToStopPoints: dist(price, stopPrice),
    distanceToTp1Points: dist(
      price,
      positive(quickTarget.tp1) ?? positive(finalTakeProfits.find((t) => t.label === "TP1")?.price)
    ),
    quoteAgeSeconds: ageSeconds(
      mutation === "PLAN_UNCHANGED" ? now : existing?.lastQuoteAt,
      nowMs
    ),
    signalAgeSeconds: ageSeconds(
      mutation === "CREATED" || mutation === "REPLACED" ? now : existing?.lastPlanAt ?? now,
      nowMs
    ),
    lastQuoteAt:
      mutation === "PLAN_UNCHANGED" ? now : existing?.lastQuoteAt ?? null,
    lastPlanAt:
      mutation === "CREATED" || mutation === "REPLACED"
        ? now
        : existing?.lastPlanAt ?? now,
    lastConfirmAt:
      mutation === "STATUS_UPDATED" ? now : existing?.lastConfirmAt ?? null,
    planQuality,
    quickTarget,
    sourceDecisionId:
      lockStrategy && existing?.sourceDecisionId
        ? existing.sourceDecisionId
        : decision.decisionId,
    marketStructureMode,
    session: decision.currentSession ?? existing?.session ?? null,
    higherTimeframeBias:
      lockStrategy
        ? existing?.higherTimeframeBias ?? decision.higherTimeframeBias
        : decision.higherTimeframeBias,
    invalidation: decision.invalidation ?? existing?.invalidation ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    validUntil,
    environment: decision.environment,
    isTestPlan: decision.isTestDecision,
    safety: safetyBlock(),
    disclaimer: SESSION_PLAN_DISCLAIMER
  };

  return base;
};

export interface ProcessSessionPlanArgs {
  userId: string;
  payload: TradingViewPayload;
  decision: DecisionRecord;
  store: GoldMetaStore;
  marketStructureMode?: MarketStructureMode;
}

/**
 * Apply webhook + decision to the user's stable session plan.
 * Idempotent for duplicate event processing when planSourceKey + mutation match.
 */
export const processSessionPlanLifecycle = async (
  args: ProcessSessionPlanArgs
): Promise<SessionPlanRecord> => {
  const { userId, payload, decision, store } = args;
  const role = resolveAlertRole(payload);
  const existing = (await store.getActiveSessionPlan?.(userId)) ?? null;
  const chartMatchesRole = metadataBool(payload, "chartMatchesRole");
  const mode = args.marketStructureMode ?? null;

  // Hard NO_TRADE on mismatch / role mismatch.
  if (mode === "MISMATCH" || chartMatchesRole === false) {
    const plan = emptyNoValidPlan(
      userId,
      payload,
      decision,
      "NO_TRADE",
      "NO_TRADE",
      mode === "MISMATCH"
        ? ["PRICE_SOURCE_MISMATCH", "NO_TRADE"]
        : ["CHART_ROLE_MISMATCH", "NO_TRADE"],
      mode
    );
    // Preserve prior strategy fields for display but mark NO_TRADE.
    const merged =
      existing && existing.direction && existing.direction !== "WAIT"
        ? {
            ...plan,
            planId: existing.planId,
            planSourceKey: existing.planSourceKey,
            direction: existing.direction,
            entry: existing.entry,
            stopLoss: existing.stopLoss,
            takeProfits: existing.takeProfits,
            riskReward: existing.riskReward,
            quickTarget: existing.quickTarget,
            createdAt: existing.createdAt,
            lastPlanAt: existing.lastPlanAt,
            sourceDecisionId: existing.sourceDecisionId,
            planQuality: { grade: "NO_PLAN" as const, reasons: plan.planQuality.reasons }
          }
        : plan;
    await store.saveSessionPlan?.(merged);
    return merged;
  }

  // Quotes: never create plan; refresh price only.
  if (isQuoteAlert(role)) {
    if (!existing || existing.lifecycleState === "NO_VALID_PLAN") {
      const plan = emptyNoValidPlan(
        userId,
        payload,
        decision,
        "NO_VALID_PLAN",
        "NO_VALID_PLAN",
        ["NO_VALID_15M_PLAN", "QUOTE_WITHOUT_PLAN"],
        mode ?? "LIVE_RANGE_ONLY"
      );
      await store.saveSessionPlan?.(plan);
      return plan;
    }
    const price = positive(decision.lastKnownPrice) ?? positive(payload.ohlcv?.close);
    const nowMs = Date.now();
    let updated = refreshDistances(
      {
        ...existing,
        planMutation: "PLAN_UNCHANGED",
        planStabilityLabel: "PLAN UNCHANGED",
        alertRole: metadataString(payload, "alertRole") ?? existing.alertRole,
        lastQuoteAt: nowIso(),
        marketStructureMode: mode ?? existing.marketStructureMode
      },
      price,
      nowMs
    );
    updated = {
      ...updated,
      lifecycleState: deriveLifecycleFromPrice({
        previous: existing.lifecycleState,
        direction: existing.direction,
        price,
        entry: positive(existing.entry?.price) ?? positive(existing.entry?.zoneLow),
        zoneLow: positive(existing.entry?.zoneLow),
        zoneHigh: positive(existing.entry?.zoneHigh),
        stop: positive(existing.stopLoss?.price),
        tp1:
          positive(existing.quickTarget.tp1) ??
          positive(existing.takeProfits.find((t) => t.label === "TP1")?.price),
        tp2: positive(existing.takeProfits.find((t) => t.label === "TP2")?.price),
        confirmationState: existing.confirmationState,
        nowMs,
        validUntil: existing.validUntil
      })
    };
    // Guarantee strategy fields unchanged.
    updated = {
      ...updated,
      direction: existing.direction,
      entry: existing.entry,
      stopLoss: existing.stopLoss,
      takeProfits: existing.takeProfits,
      riskReward: existing.riskReward,
      quickTarget: existing.quickTarget,
      sourceDecisionId: existing.sourceDecisionId,
      planId: existing.planId,
      planSourceKey: existing.planSourceKey
    };
    await store.saveSessionPlan?.(updated);
    return updated;
  }

  // CONFIRM_5M: never create plan; status only.
  if (isConfirmAlert(role)) {
    if (!existing || existing.lifecycleState === "NO_VALID_PLAN") {
      const plan = emptyNoValidPlan(
        userId,
        payload,
        decision,
        "NO_VALID_PLAN",
        "NO_VALID_PLAN",
        ["NO_VALID_15M_PLAN", "CONFIRM_WITHOUT_PLAN"],
        mode
      );
      await store.saveSessionPlan?.(plan);
      return plan;
    }
    const confirmationState =
      extractConfirmationState(payload) ?? existing.confirmationState;
    const price = positive(decision.lastKnownPrice) ?? positive(payload.ohlcv?.close);
    const nowMs = Date.now();
    let updated: SessionPlanRecord = {
      ...existing,
      confirmationState,
      planMutation: "STATUS_UPDATED",
      planStabilityLabel: "STATUS UPDATED",
      alertRole: "CONFIRM_5M",
      lastConfirmAt: nowIso(),
      updatedAt: nowIso(),
      currentPrice: price ?? existing.currentPrice,
      marketStructureMode: mode ?? existing.marketStructureMode,
      // Never replace strategy fields from 5M decision.
      direction: existing.direction,
      entry: existing.entry,
      stopLoss: existing.stopLoss,
      takeProfits: existing.takeProfits,
      riskReward: existing.riskReward,
      quickTarget: existing.quickTarget,
      sourceDecisionId: existing.sourceDecisionId,
      planId: existing.planId
    };
    updated = {
      ...updated,
      lifecycleState: deriveLifecycleFromPrice({
        previous: existing.lifecycleState,
        direction: existing.direction,
        price: updated.currentPrice,
        entry: positive(existing.entry?.price) ?? positive(existing.entry?.zoneLow),
        zoneLow: positive(existing.entry?.zoneLow),
        zoneHigh: positive(existing.entry?.zoneHigh),
        stop: positive(existing.stopLoss?.price),
        tp1:
          positive(existing.quickTarget.tp1) ??
          positive(existing.takeProfits.find((t) => t.label === "TP1")?.price),
        tp2: positive(existing.takeProfits.find((t) => t.label === "TP2")?.price),
        confirmationState,
        nowMs,
        validUntil: existing.validUntil
      }),
      planQuality: evaluatePlanQuality({
        decision: {
          ...decision,
          decision: existing.direction ?? "WAIT",
          entry: existing.entry ?? decision.entry,
          stopLoss: existing.stopLoss ?? decision.stopLoss,
          takeProfits: existing.takeProfits
        },
        marketStructureMode: mode ?? existing.marketStructureMode,
        confirmationState,
        chartMatchesRole: existing.chartMatchesRole,
        quickTargetRrOk: existing.quickTarget.rrOk,
        hasFourHourContext: existing.fourHourContext != null
      })
    };
    updated = refreshDistances(updated, price, nowMs);
    await store.saveSessionPlan?.(updated);
    return updated;
  }

  // PLAN_15M / legacy STRATEGY — create or replace when complete confirmed.
  if (isPlanSourceAlert(role)) {
    const complete =
      isCompleteStrategySignal(decision) ||
      (!decision.isProvisional &&
        positive(decision.marketStructure?.poc) != null &&
        positive(decision.marketStructure?.vah) != null &&
        positive(decision.marketStructure?.val) != null);

    // Provisional / incomplete → BUILDING, do not replace a good plan with incomplete.
    if (!payload.isConfirmedBar || !complete) {
      if (existing && existing.lifecycleState !== "NO_VALID_PLAN" && existing.direction) {
        const plan = {
          ...existing,
          planMutation: "PLAN_UNCHANGED" as const,
          planStabilityLabel: "PLAN UNCHANGED" as const,
          lifecycleState:
            existing.lifecycleState === "EXPIRED" || existing.lifecycleState === "INVALIDATED"
              ? existing.lifecycleState
              : ("BUILDING" as const),
          updatedAt: nowIso()
        };
        await store.saveSessionPlan?.(plan);
        return plan;
      }
      const building = emptyNoValidPlan(
        userId,
        payload,
        decision,
        "NO_VALID_PLAN",
        "BUILDING",
        ["BUILDING_INCOMPLETE_15M"],
        mode ?? "LIVE_RANGE_ONLY"
      );
      building.lifecycleState = "BUILDING";
      building.planQuality = EMPTY_PLAN_QUALITY();
      building.planQuality.reasons = ["BUILDING_INCOMPLETE_15M"];
      await store.saveSessionPlan?.(building);
      return building;
    }

    const planSourceKey = extractPlanSourceKey(payload);
    const sameKey =
      existing &&
      planSourceKey &&
      existing.planSourceKey === planSourceKey &&
      existing.lifecycleState !== "INVALIDATED" &&
      existing.lifecycleState !== "EXPIRED" &&
      existing.lifecycleState !== "NO_VALID_PLAN";

    // Material HTF change or new planSourceKey → replace.
    const htfChanged =
      existing?.higherTimeframeBias != null &&
      decision.higherTimeframeBias != null &&
      existing.higherTimeframeBias !== decision.higherTimeframeBias &&
      decision.higherTimeframeBias !== "NEUTRAL";

    const mutation: PlanMutation = !existing || existing.lifecycleState === "NO_VALID_PLAN"
      ? "CREATED"
      : sameKey && !htfChanged
        ? "REPLACED" // new confirmed 15M bar with same session key still refreshes structure
        : "REPLACED";

    // If identical strategy fields and same key, treat as PLAN_UNCHANGED for stability.
    const entryPrice = positive(decision.entry?.price);
    const prevEntry = positive(existing?.entry?.price);
    const identical =
      sameKey &&
      existing &&
      existing.direction === decision.decision &&
      prevEntry != null &&
      entryPrice != null &&
      Math.abs(prevEntry - entryPrice) < 0.01 &&
      positive(existing.stopLoss?.price) != null &&
      positive(decision.stopLoss?.price) != null &&
      Math.abs(positive(existing.stopLoss!.price)! - positive(decision.stopLoss!.price)!) < 0.01;

    const finalMutation: PlanMutation = identical ? "PLAN_UNCHANGED" : mutation;

    const plan = buildPlanFromDecision({
      userId,
      payload,
      decision,
      existing,
      marketStructureMode: mode ?? "COMPLETE",
      mutation: finalMutation === "PLAN_UNCHANGED" ? "PLAN_UNCHANGED" : mutation === "CREATED" ? "CREATED" : "REPLACED"
    });

    // Preserve planId when same planSourceKey for UI stability.
    if (existing && planSourceKey && existing.planSourceKey === planSourceKey) {
      plan.planId = existing.planId;
      plan.createdAt = existing.createdAt;
    }

    await store.saveSessionPlan?.(plan);
    return plan;
  }

  // Unknown role without existing plan.
  if (!existing) {
    const plan = emptyNoValidPlan(
      userId,
      payload,
      decision,
      "NO_VALID_PLAN",
      "NO_VALID_PLAN",
      ["UNKNOWN_ALERT_ROLE", "NO_VALID_15M_PLAN"],
      mode
    );
    await store.saveSessionPlan?.(plan);
    return plan;
  }

  logger.info("Session plan left unchanged for unrecognized alert role", {
    userId,
    role,
    planId: existing.planId
  });
  return existing;
};

/** Read helper for GET /v1/decisions/latest — synthesizes NO_VALID_PLAN when absent. */
export const getOrEmptySessionPlan = async (
  store: GoldMetaStore,
  userId: string
): Promise<SessionPlanRecord | null> => {
  if (!store.getActiveSessionPlan) return null;
  return (await store.getActiveSessionPlan(userId)) ?? null;
};
