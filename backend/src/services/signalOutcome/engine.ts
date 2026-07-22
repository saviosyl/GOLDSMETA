/**
 * Pure Signal Outcome engine — deterministic bar application.
 * No broker I/O. No mock prices injected silently.
 */

import { createHash, randomUUID } from "crypto";
import { nowIso } from "../../utils/time";
import type { DecisionRecord } from "../../models/types";
import {
  HYPOTHETICAL_DISCLAIMER,
  HYPOTHETICAL_LABEL,
  type AmbiguityRecord,
  type SignalBarInput,
  type SignalExitLeg,
  type SignalLifecycle,
  type SignalManagementEvent,
  type SignalOutcomeRecord,
  type SignalSnapshot
} from "./types";

export const signalIdForDecision = (decisionId: string): string =>
  createHash("sha256").update(`signal-outcome|${decisionId}`).digest("hex").slice(0, 24);

const tp = (d: DecisionRecord, label: "TP1" | "TP2" | "TP3"): number | null =>
  d.takeProfits.find((t) => t.label === label)?.price ?? null;

export function freezeSignalSnapshot(decision: DecisionRecord): SignalSnapshot {
  const entry = decision.entry;

  return {
    signalId: signalIdForDecision(decision.decisionId),
    decisionId: decision.decisionId,
    userId: decision.userId,
    symbol: "XAUUSD",
    market: "XAUUSD",
    timeframe: decision.timeframe ?? "",
    direction: decision.decision,
    createdAt: decision.generatedAt,
    marketDataTimestamp: decision.marketDataTime ?? decision.barTime,
    entryType: entry?.type ?? null,
    proposedEntryPrice: entry?.price ?? null,
    entryZoneLow: entry?.zoneLow ?? null,
    entryZoneHigh: entry?.zoneHigh ?? null,
    stopLoss: decision.stopLoss?.price ?? null,
    tp1: tp(decision, "TP1"),
    tp2: tp(decision, "TP2"),
    tp3: tp(decision, "TP3"),
    initialRiskDistance:
      entry?.price != null && decision.stopLoss?.price != null
        ? Math.abs(entry.price - decision.stopLoss.price)
        : null,
    riskReward: { ...decision.riskReward },
    confidence: decision.confidence,
    setupScore: decision.setupScore,
    strategy: decision.marketRegime ?? null,
    reasons: [...(decision.reasonCodes ?? [])],
    blockingReasons: decision.decision === "WAIT" ? [...(decision.reasonCodes ?? [])] : [],
    dataQuality: decision.dataQuality,
    signalSource: "goldmeta-decision-engine",
    decisionVersion: decision.schemaVersion,
    environment: decision.environment === "TEST" ? "TEST" : "LIVE",
    session: decision.currentSession ?? null
  };
}

export function createSignalOutcomeFromDecision(decision: DecisionRecord): SignalOutcomeRecord {
  const snapshot = freezeSignalSnapshot(decision);
  const isWait = decision.decision === "WAIT";
  const now = nowIso();
  return {
    schemaVersion: "1.0",
    snapshot,
    entry: {
      entryReached: false,
      entryTimestamp: null,
      entryPrice: null,
      entrySpreadEstimate: null,
      entrySlippageEstimate: null,
      entryMarketDataSource: null,
      entryBlockedByStaleData: false,
      expiredWithoutEntry: false
    },
    monitoring: {
      lifecycle: isWait ? "WAIT_ONLY" : "PENDING_ENTRY",
      currentPrice: null,
      latestMarketDataTimestamp: null,
      highestFavourablePrice: null,
      lowestAdversePrice: null,
      mfe: null,
      mae: null,
      stopStatus: isWait || snapshot.stopLoss == null ? "N/A" : "ACTIVE",
      tp1Status: snapshot.tp1 == null ? "N/A" : "PENDING",
      tp2Status: snapshot.tp2 == null ? "N/A" : "PENDING",
      tp3Status: snapshot.tp3 == null ? "N/A" : "PENDING",
      currentGrossPoints: null,
      currentNetPoints: null,
      currentRMultiple: null,
      timeInTradeMs: null,
      lastMonitoringAt: now,
      workingStop: snapshot.stopLoss,
      quantityRemainingPct: 100
    },
    managementEvents: [],
    exitLegs: [],
    finalResult: isWait
      ? {
          outcome: null,
          exitReason: "WAIT signal — not a trade",
          exitTimestamp: null,
          exitPrice: null,
          entryPrice: null,
          holdingDurationMs: null,
          grossPoints: null,
          estimatedSpread: null,
          estimatedSlippage: null,
          estimatedFees: null,
          netPoints: null,
          percentageResult: null,
          grossR: null,
          netR: null,
          mfe: null,
          mae: null,
          targetsReached: [],
          dataQualityAtEntry: null,
          dataQualityAtExit: null,
          label: HYPOTHETICAL_LABEL,
          disclaimer: HYPOTHETICAL_DISCLAIMER
        }
      : null,
    ambiguity: null,
    appliedBarEventIds: [],
    // Seed so the creation candle (barTime === marketDataTimestamp) cannot create lookahead.
    lastAppliedBarTime: snapshot.marketDataTimestamp,
    leaseOwnerId: null,
    leaseUntil: null,
    updatedAt: now
  };
}

const pushEvent = (
  record: SignalOutcomeRecord,
  partial: Omit<SignalManagementEvent, "eventId" | "at"> & { at?: string }
): void => {
  record.managementEvents.push({
    eventId: randomUUID(),
    at: partial.at ?? nowIso(),
    type: partial.type,
    barTime: partial.barTime,
    price: partial.price,
    oldStop: partial.oldStop,
    newStop: partial.newStop,
    targetReached: partial.targetReached,
    quantityPctClosed: partial.quantityPctClosed,
    reason: partial.reason,
    priceSource: partial.priceSource
  });
};

export const pointsFrom = (direction: "BUY" | "SELL", entry: number, exit: number): number =>
  Math.round(((direction === "BUY" ? exit - entry : entry - exit) + Number.EPSILON) * 100) / 100;

export const rFrom = (points: number, risk: number | null): number | null => {
  if (risk == null || risk <= 0) return null;
  return Math.round((points / risk) * 100) / 100;
};

/** Normalize GoldMeta confidence to 0–100 (accept legacy 0–1 fractions). */
export function confidenceOnHundredScale(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  if (confidence > 0 && confidence <= 1) return Math.round(confidence * 100);
  return Math.round(confidence);
}

export type BarRejectReason =
  | "DUPLICATE_EVENT"
  | "WRONG_SYMBOL"
  | "WRONG_TIMEFRAME"
  | "WRONG_ENVIRONMENT"
  | "SAME_CANDLE_SKIP"
  | "OUT_OF_ORDER_WAIT"
  | "UNCONFIRMED"
  | null;

/**
 * Validate bar identity / chronology before mutation.
 * - Creation candle (barTime <= marketDataTimestamp) → SAME_CANDLE_SKIP
 * - Chronologically older than lastApplied (but after creation) → OUT_OF_ORDER_WAIT
 *   (do not permanently discard — earlier bar may still be in flight)
 */
export function validateBarForSignal(
  record: SignalOutcomeRecord,
  bar: SignalBarInput
): BarRejectReason {
  if (record.appliedBarEventIds.includes(bar.eventId)) return "DUPLICATE_EVENT";
  if (bar.symbol !== record.snapshot.symbol) return "WRONG_SYMBOL";
  const snapTf = record.snapshot.timeframe ?? null;
  const barTf = bar.timeframe ?? null;
  if (String(snapTf ?? "") !== String(barTf ?? "")) return "WRONG_TIMEFRAME";
  if (bar.environment !== record.snapshot.environment) return "WRONG_ENVIRONMENT";
  if (!bar.isConfirmedBar) return "UNCONFIRMED";

  const barMs = Date.parse(bar.barTime);
  const creationMs = Date.parse(record.snapshot.marketDataTimestamp);
  if (Number.isFinite(barMs) && Number.isFinite(creationMs) && barMs <= creationMs) {
    return "SAME_CANDLE_SKIP";
  }
  if (record.lastAppliedBarTime) {
    const lastMs = Date.parse(record.lastAppliedBarTime);
    if (Number.isFinite(barMs) && Number.isFinite(lastMs) && barMs <= lastMs) {
      return "OUT_OF_ORDER_WAIT";
    }
  }
  return null;
}

function entryTouched(snapshot: SignalSnapshot, bar: SignalBarInput): boolean {
  if (snapshot.direction !== "BUY" && snapshot.direction !== "SELL") return false;
  const low = snapshot.entryZoneLow ?? snapshot.proposedEntryPrice;
  const high = snapshot.entryZoneHigh ?? snapshot.proposedEntryPrice;
  if (low == null || high == null) return false;
  return bar.low <= high && bar.high >= low;
}

function fillPrice(snapshot: SignalSnapshot): number | null {
  if (snapshot.proposedEntryPrice != null) return snapshot.proposedEntryPrice;
  if (snapshot.entryZoneLow != null && snapshot.entryZoneHigh != null) {
    return (snapshot.entryZoneLow + snapshot.entryZoneHigh) / 2;
  }
  return null;
}

function targetHit(direction: "BUY" | "SELL", target: number, bar: SignalBarInput): boolean {
  return direction === "BUY" ? bar.high >= target : bar.low <= target;
}

function stopHit(direction: "BUY" | "SELL", stop: number, bar: SignalBarInput): boolean {
  return direction === "BUY" ? bar.low <= stop : bar.high >= stop;
}

function markBarApplied(record: SignalOutcomeRecord, bar: SignalBarInput): void {
  if (!record.appliedBarEventIds.includes(bar.eventId)) {
    record.appliedBarEventIds.push(bar.eventId);
  }
  record.lastAppliedBarTime = bar.barTime;
  record.updatedAt = nowIso();
}

function addExitLeg(
  record: SignalOutcomeRecord,
  partial: Omit<SignalExitLeg, "legId" | "at"> & { at?: string }
): SignalExitLeg {
  const leg: SignalExitLeg = {
    legId: randomUUID(),
    at: partial.at ?? nowIso(),
    reason: partial.reason,
    quantityPct: partial.quantityPct,
    exitPrice: partial.exitPrice,
    grossPointsContribution: partial.grossPointsContribution,
    spreadSlippageContribution: partial.spreadSlippageContribution,
    realizedRContribution: partial.realizedRContribution,
    barTime: partial.barTime
  };
  record.exitLegs.push(leg);
  return leg;
}

function buildLegContributions(
  record: SignalOutcomeRecord,
  quantityPct: number,
  exitPrice: number
): Pick<
  SignalExitLeg,
  "grossPointsContribution" | "spreadSlippageContribution" | "realizedRContribution"
> {
  const entryPrice = record.entry.entryPrice!;
  const direction = record.snapshot.direction as "BUY" | "SELL";
  const unitGross = pointsFrom(direction, entryPrice, exitPrice);
  const spread = record.entry.entrySpreadEstimate ?? 0;
  const slip = record.entry.entrySlippageEstimate ?? 0;
  const unitCost = spread + slip;
  const risk = record.snapshot.initialRiskDistance;
  const frac = quantityPct / 100;
  const grossPointsContribution = Math.round(unitGross * frac * 100) / 100;
  const spreadSlippageContribution = Math.round(unitCost * frac * 100) / 100;
  const unitR = rFrom(unitGross, risk) ?? 0;
  const realizedRContribution = Math.round(unitR * frac * 100) / 100;
  return { grossPointsContribution, spreadSlippageContribution, realizedRContribution };
}

/**
 * total result = sum(closed% × leg result) + remaining% × final exit
 * Outcome is derived from net R across all legs — never from the final exit price alone.
 */
export function finalizeFromExitLegs(
  record: SignalOutcomeRecord,
  lifecycle: SignalLifecycle,
  bar: SignalBarInput,
  reason: string,
  targetsReached: Array<"TP1" | "TP2" | "TP3">,
  ambiguousOutcome = false
): void {
  const entryPrice = record.entry.entryPrice;
  const grossPoints =
    Math.round(record.exitLegs.reduce((s, l) => s + l.grossPointsContribution, 0) * 100) / 100;
  const spreadSlip =
    Math.round(record.exitLegs.reduce((s, l) => s + l.spreadSlippageContribution, 0) * 100) / 100;
  const fees = 0;
  const netPoints = Math.round((grossPoints - spreadSlip - fees) * 100) / 100;
  const risk = record.snapshot.initialRiskDistance;
  const grossRRaw = record.exitLegs.reduce((s, l) => s + l.realizedRContribution, 0);
  const costR = risk != null && risk > 0 ? spreadSlip / risk : 0;
  const netR =
    risk != null && risk > 0 ? Math.round((grossRRaw - costR) * 100) / 100 : rFrom(netPoints, risk);

  const lastLeg = record.exitLegs[record.exitLegs.length - 1] ?? null;
  const holding =
    record.entry.entryTimestamp != null
      ? Math.max(0, new Date(bar.barTime).getTime() - new Date(record.entry.entryTimestamp).getTime())
      : null;

  let outcome: NonNullable<SignalOutcomeRecord["finalResult"]>["outcome"];
  if (ambiguousOutcome) {
    outcome = "AMBIGUOUS";
  } else if (netR == null) {
    outcome = netPoints > 0.01 ? "WIN" : netPoints < -0.01 ? "LOSS" : "BREAKEVEN";
  } else if (netR > 0.01) {
    outcome = "WIN";
  } else if (netR < -0.01) {
    outcome = "LOSS";
  } else {
    outcome = "BREAKEVEN";
  }

  if (lifecycle === "AMBIGUOUS_INTRABAR") {
    record.monitoring.lifecycle = "AMBIGUOUS_INTRABAR";
  } else if (lifecycle === "STOP_HIT" || lifecycle === "TP3_HIT" || lifecycle === "CLOSED") {
    record.monitoring.lifecycle = lifecycle === "STOP_HIT" ? "STOP_HIT" : "CLOSED";
    if (lifecycle === "TP3_HIT") record.monitoring.lifecycle = "CLOSED";
    if (lifecycle === "STOP_HIT") record.monitoring.lifecycle = "CLOSED";
  } else {
    record.monitoring.lifecycle = "CLOSED";
  }

  record.finalResult = {
    outcome,
    exitReason: reason,
    exitTimestamp: bar.barTime,
    exitPrice: lastLeg?.exitPrice ?? null,
    entryPrice,
    holdingDurationMs: holding,
    grossPoints,
    estimatedSpread: record.entry.entrySpreadEstimate,
    estimatedSlippage: record.entry.entrySlippageEstimate,
    estimatedFees: fees,
    netPoints,
    percentageResult:
      entryPrice != null && entryPrice !== 0
        ? Math.round((netPoints / entryPrice) * 10000) / 100
        : null,
    grossR: Math.round(grossRRaw * 100) / 100,
    netR,
    mfe: record.monitoring.mfe,
    mae: record.monitoring.mae,
    targetsReached,
    dataQualityAtEntry: record.snapshot.dataQuality,
    dataQualityAtExit: bar.dataQuality ?? "OK",
    label: HYPOTHETICAL_LABEL,
    disclaimer: HYPOTHETICAL_DISCLAIMER
  };
  record.monitoring.quantityRemainingPct = 0;
  record.updatedAt = nowIso();
}

function updateExcursion(record: SignalOutcomeRecord, bar: SignalBarInput): void {
  const entry = record.entry.entryPrice;
  if (entry == null || (record.snapshot.direction !== "BUY" && record.snapshot.direction !== "SELL")) {
    return;
  }
  const dir = record.snapshot.direction;
  const favPrice = dir === "BUY" ? bar.high : bar.low;
  const advPrice = dir === "BUY" ? bar.low : bar.high;

  if (
    record.monitoring.highestFavourablePrice == null ||
    (dir === "BUY"
      ? favPrice > record.monitoring.highestFavourablePrice
      : favPrice < record.monitoring.highestFavourablePrice)
  ) {
    record.monitoring.highestFavourablePrice = favPrice;
  }
  if (
    record.monitoring.lowestAdversePrice == null ||
    (dir === "BUY"
      ? advPrice < record.monitoring.lowestAdversePrice
      : advPrice > record.monitoring.lowestAdversePrice)
  ) {
    record.monitoring.lowestAdversePrice = advPrice;
  }

  const mfePts = pointsFrom(dir, entry, record.monitoring.highestFavourablePrice);
  const maePts = pointsFrom(dir, entry, record.monitoring.lowestAdversePrice);
  record.monitoring.mfe = Math.max(0, mfePts);
  record.monitoring.mae = Math.min(0, maePts);
}

function targetsReachedList(record: SignalOutcomeRecord): Array<"TP1" | "TP2" | "TP3"> {
  const out: Array<"TP1" | "TP2" | "TP3"> = [];
  if (record.monitoring.tp1Status === "HIT") out.push("TP1");
  if (record.monitoring.tp2Status === "HIT") out.push("TP2");
  if (record.monitoring.tp3Status === "HIT") out.push("TP3");
  return out;
}

function levelInBarRange(level: number, bar: SignalBarInput): boolean {
  return bar.low <= level && bar.high >= level;
}

/** Stop or any pending TP also traded in this bar's OHLC range. */
function conflictingExitInBar(snapshot: SignalSnapshot, bar: SignalBarInput): {
  stopInRange: boolean;
  targetInRange: boolean;
} {
  const stopInRange = snapshot.stopLoss != null && levelInBarRange(snapshot.stopLoss, bar);
  const targetInRange =
    (snapshot.tp1 != null && levelInBarRange(snapshot.tp1, bar)) ||
    (snapshot.tp2 != null && levelInBarRange(snapshot.tp2, bar)) ||
    (snapshot.tp3 != null && levelInBarRange(snapshot.tp3, bar));
  return { stopInRange, targetInRange };
}

/**
 * Walk ordered ticks chronologically:
 * - Ignore stop/target before the first entry tick
 * - If entry never reached → null (caller keeps PENDING_ENTRY)
 * - After entry, first stop/target event drives lifecycle; successive TPs allowed
 */
export function findEntryTickIndex(
  snapshot: SignalSnapshot,
  ticks: Array<{ t: number; price: number }>
): number {
  const fill = fillPrice(snapshot);
  if (fill == null) return -1;
  const low = snapshot.entryZoneLow ?? fill;
  const high = snapshot.entryZoneHigh ?? fill;
  const sorted = [...ticks].sort((a, b) => a.t - b.t);
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!.price;
    if (p >= low && p <= high) return i;
  }
  return -1;
}

/**
 * Apply stop/TP events from ticks that occur at or after entryIndex.
 * Mutates record. Returns true if trade closed.
 */
function applyPostEntryTicks(
  record: SignalOutcomeRecord,
  bar: SignalBarInput,
  sortedTicks: Array<{ t: number; price: number }>,
  entryIndex: number
): boolean {
  const snap = record.snapshot;
  if (snap.direction !== "BUY" && snap.direction !== "SELL") return false;
  const direction = snap.direction;
  const after = sortedTicks.slice(entryIndex);

  for (const tick of after) {
    if (
      record.monitoring.lifecycle !== "OPEN" &&
      record.monitoring.lifecycle !== "TP1_HIT" &&
      record.monitoring.lifecycle !== "TP2_HIT" &&
      record.monitoring.lifecycle !== "BREAKEVEN"
    ) {
      break;
    }
    const stop = record.monitoring.workingStop;
    const pendingTargets: Array<{
      label: "TP1" | "TP2" | "TP3";
      price: number;
      statusKey: "tp1Status" | "tp2Status" | "tp3Status";
    }> = [];
    if (snap.tp1 != null && record.monitoring.tp1Status === "PENDING") {
      pendingTargets.push({ label: "TP1", price: snap.tp1, statusKey: "tp1Status" });
    }
    if (snap.tp2 != null && record.monitoring.tp2Status === "PENDING") {
      pendingTargets.push({ label: "TP2", price: snap.tp2, statusKey: "tp2Status" });
    }
    if (snap.tp3 != null && record.monitoring.tp3Status === "PENDING") {
      pendingTargets.push({ label: "TP3", price: snap.tp3, statusKey: "tp3Status" });
    }

    const stopHitNow =
      stop != null && (direction === "BUY" ? tick.price <= stop : tick.price >= stop);
    const targetsHitNow = pendingTargets.filter((t) =>
      direction === "BUY" ? tick.price >= t.price : tick.price <= t.price
    );

    if (stop != null && stopHitNow && targetsHitNow.length > 0) {
      record.ambiguity = {
        candleTimestamp: bar.barTime,
        candleHigh: bar.high,
        candleLow: bar.low,
        stop,
        target: targetsHitNow[0]!.price,
        missingDataRequired: "finer tick resolution — stop and target on same tick"
      };
      const remaining = record.monitoring.quantityRemainingPct;
      const contrib = buildLegContributions(record, remaining, stop);
      addExitLeg(record, {
        reason: "AMBIGUOUS",
        quantityPct: remaining,
        exitPrice: stop,
        barTime: bar.barTime,
        ...contrib
      });
      finalizeFromExitLegs(
        record,
        "AMBIGUOUS_INTRABAR",
        bar,
        "Ambiguous same-tick stop and target",
        targetsReachedList(record),
        true
      );
      return true;
    }

    if (stop != null && stopHitNow) {
      const remaining = record.monitoring.quantityRemainingPct;
      const isBe =
        record.monitoring.lifecycle === "BREAKEVEN" ||
        (record.entry.entryPrice != null && stop === record.entry.entryPrice);
      const contrib = buildLegContributions(record, remaining, stop);
      addExitLeg(record, {
        reason: isBe ? "BREAKEVEN" : "STOP",
        quantityPct: remaining,
        exitPrice: stop,
        barTime: bar.barTime,
        ...contrib
      });
      record.monitoring.stopStatus = "HIT";
      pushEvent(record, {
        type: "STOP",
        barTime: bar.barTime,
        price: stop,
        oldStop: stop,
        newStop: stop,
        targetReached: null,
        quantityPctClosed: remaining,
        reason: isBe ? "Stop hit at breakeven (ordered ticks)" : "Stop hit (ordered ticks)",
        priceSource: "ordered-ticks"
      });
      finalizeFromExitLegs(
        record,
        "STOP_HIT",
        bar,
        isBe ? "Stop loss hit at breakeven" : "Stop loss hit",
        targetsReachedList(record)
      );
      return true;
    }

    for (const t of targetsHitNow) {
      record.monitoring[t.statusKey] = "HIT";
      const pct = t.label === "TP1" ? 40 : t.label === "TP2" ? 30 : 30;
      const closePct = Math.min(pct, record.monitoring.quantityRemainingPct);
      record.monitoring.quantityRemainingPct = Math.max(
        0,
        record.monitoring.quantityRemainingPct - closePct
      );
      record.monitoring.lifecycle =
        t.label === "TP1" ? "TP1_HIT" : t.label === "TP2" ? "TP2_HIT" : "TP3_HIT";
      const contrib = buildLegContributions(record, closePct, t.price);
      addExitLeg(record, {
        reason: t.label,
        quantityPct: closePct,
        exitPrice: t.price,
        barTime: bar.barTime,
        ...contrib
      });
      pushEvent(record, {
        type: t.label,
        barTime: bar.barTime,
        price: t.price,
        oldStop: record.monitoring.workingStop,
        newStop: record.monitoring.workingStop,
        targetReached: t.label,
        quantityPctClosed: closePct,
        reason: `${t.label} hit (ordered ticks)`,
        priceSource: "ordered-ticks"
      });
      if (t.label === "TP1" && record.entry.entryPrice != null) {
        const old = record.monitoring.workingStop;
        record.monitoring.workingStop = record.entry.entryPrice;
        record.monitoring.stopStatus = "MOVED_BREAKEVEN";
        record.monitoring.lifecycle = "BREAKEVEN";
        pushEvent(record, {
          type: "BREAKEVEN_MOVE",
          barTime: bar.barTime,
          price: record.entry.entryPrice,
          oldStop: old,
          newStop: record.entry.entryPrice,
          targetReached: null,
          quantityPctClosed: null,
          reason: "Stop moved to breakeven after TP1 (ordered ticks)",
          priceSource: "ordered-ticks"
        });
      }
      if (t.label === "TP3" || record.monitoring.quantityRemainingPct <= 0) {
        finalizeFromExitLegs(
          record,
          t.label === "TP3" ? "TP3_HIT" : "CLOSED",
          bar,
          `${t.label} completed hypothetical trade (ordered ticks)`,
          targetsReachedList(record)
        );
        return true;
      }
    }
  }
  return false;
}

function applyEntryFill(
  record: SignalOutcomeRecord,
  bar: SignalBarInput,
  fill: number,
  reason: string
): void {
  record.entry = {
    entryReached: true,
    entryTimestamp: bar.barTime,
    entryPrice: fill,
    entrySpreadEstimate: 0.1,
    entrySlippageEstimate: 0,
    entryMarketDataSource: bar.source ?? "tradingview-ohlcv",
    entryBlockedByStaleData: false,
    expiredWithoutEntry: false
  };
  record.monitoring.lifecycle = "OPEN";
  record.monitoring.currentPrice = bar.close;
  record.monitoring.latestMarketDataTimestamp = bar.barTime;
  record.monitoring.lastMonitoringAt = nowIso();
  pushEvent(record, {
    type: "ENTRY",
    barTime: bar.barTime,
    price: fill,
    oldStop: null,
    newStop: record.monitoring.workingStop,
    targetReached: null,
    quantityPctClosed: null,
    reason,
    priceSource: bar.source ?? "tradingview-ohlcv"
  });
}

/**
 * Apply one confirmed bar. Idempotent on eventId.
 * Rejects wrong identity, duplicates, and barTime <= lastApplied/creation candle.
 */
export function applyBarToSignalOutcome(
  record: SignalOutcomeRecord,
  bar: SignalBarInput,
  opts: { maxPendingBars?: number; pendingBarsSeen?: number } = {}
): SignalOutcomeRecord {
  const reject = validateBarForSignal(record, bar);
  if (reject === "DUPLICATE_EVENT") return record;
  if (
    reject === "WRONG_SYMBOL" ||
    reject === "WRONG_TIMEFRAME" ||
    reject === "WRONG_ENVIRONMENT" ||
    reject === "UNCONFIRMED"
  ) {
    return record;
  }
  if (reject === "OUT_OF_ORDER_WAIT") {
    // Do not mutate / do not consume eventId — earlier bar may still be in flight.
    return record;
  }
  if (reject === "SAME_CANDLE_SKIP") {
    if (!record.appliedBarEventIds.includes(bar.eventId)) {
      record.appliedBarEventIds.push(bar.eventId);
      pushEvent(record, {
        type: "BAR_SKIPPED",
        barTime: bar.barTime,
        price: bar.close,
        oldStop: record.monitoring.workingStop,
        newStop: record.monitoring.workingStop,
        targetReached: null,
        quantityPctClosed: null,
        reason: "Same-candle lookahead rejected — entry monitoring starts on next confirmed bar",
        priceSource: bar.source ?? "tradingview-ohlcv"
      });
      record.updatedAt = nowIso();
    }
    return record;
  }

  if (
    record.monitoring.lifecycle === "WAIT_ONLY" ||
    record.monitoring.lifecycle === "CLOSED" ||
    record.monitoring.lifecycle === "EXPIRED" ||
    record.monitoring.lifecycle === "CANCELLED" ||
    record.monitoring.lifecycle === "AMBIGUOUS_INTRABAR" ||
    record.monitoring.lifecycle === "ENTRY_SEQUENCE_AMBIGUOUS" ||
    record.monitoring.lifecycle === "DATA_UNAVAILABLE" ||
    record.monitoring.lifecycle === "STOP_HIT" ||
    record.monitoring.lifecycle === "TP3_HIT"
  ) {
    markBarApplied(record, bar);
    return record;
  }

  if (bar.stale) {
    record.entry.entryBlockedByStaleData = record.monitoring.lifecycle === "PENDING_ENTRY";
    pushEvent(record, {
      type: "DATA_STALE",
      barTime: bar.barTime,
      price: bar.close,
      oldStop: record.monitoring.workingStop,
      newStop: record.monitoring.workingStop,
      targetReached: null,
      quantityPctClosed: null,
      reason: "Stale market data — no hit inferred",
      priceSource: bar.source ?? "ohlcv"
    });
    record.monitoring.lastMonitoringAt = nowIso();
    record.monitoring.latestMarketDataTimestamp = bar.barTime;
    markBarApplied(record, bar);
    return record;
  }

  if (
    !Number.isFinite(bar.open) ||
    !Number.isFinite(bar.high) ||
    !Number.isFinite(bar.low) ||
    !Number.isFinite(bar.close)
  ) {
    record.monitoring.lifecycle = "DATA_UNAVAILABLE";
    record.finalResult = {
      outcome: "DATA_UNAVAILABLE",
      exitReason: "Missing or invalid OHLC",
      exitTimestamp: bar.barTime,
      exitPrice: null,
      entryPrice: record.entry.entryPrice,
      holdingDurationMs: null,
      grossPoints: null,
      estimatedSpread: null,
      estimatedSlippage: null,
      estimatedFees: null,
      netPoints: null,
      percentageResult: null,
      grossR: null,
      netR: null,
      mfe: record.monitoring.mfe,
      mae: record.monitoring.mae,
      targetsReached: [],
      dataQualityAtEntry: record.snapshot.dataQuality,
      dataQualityAtExit: "INVALID",
      label: HYPOTHETICAL_LABEL,
      disclaimer: HYPOTHETICAL_DISCLAIMER
    };
    markBarApplied(record, bar);
    return record;
  }

  const snap = record.snapshot;
  if (snap.direction !== "BUY" && snap.direction !== "SELL") {
    markBarApplied(record, bar);
    return record;
  }
  const direction = snap.direction;

  // PENDING_ENTRY — entry-candle ordering safety (rule B with A for full conflict)
  if (record.monitoring.lifecycle === "PENDING_ENTRY") {
    const maxBars = opts.maxPendingBars ?? 48;
    const seen = (opts.pendingBarsSeen ?? record.appliedBarEventIds.length) + 1;
    const ticks = bar.orderedTicks;
    const sortedTicks = ticks && ticks.length > 0 ? [...ticks].sort((a, b) => a.t - b.t) : null;
    const entryTickIndex = sortedTicks ? findEntryTickIndex(snap, sortedTicks) : -1;

    if (sortedTicks) {
      if (entryTickIndex < 0) {
        // Entry never reached in ticks — remain PENDING_ENTRY.
        // Ambiguous only when tick coverage is incomplete AND OHLC has conflicting levels.
        const conflict = conflictingExitInBar(snap, bar);
        if (entryTouched(snap, bar) && conflict.stopInRange && conflict.targetInRange) {
          record.monitoring.lifecycle = "ENTRY_SEQUENCE_AMBIGUOUS";
          record.ambiguity = {
            candleTimestamp: bar.barTime,
            candleHigh: bar.high,
            candleLow: bar.low,
            stop: snap.stopLoss!,
            target: snap.tp1 ?? snap.tp2 ?? snap.tp3!,
            missingDataRequired: "complete ordered tick coverage through entry"
          };
          pushEvent(record, {
            type: "ENTRY_SEQUENCE_AMBIGUOUS",
            barTime: bar.barTime,
            price: bar.close,
            oldStop: record.monitoring.workingStop,
            newStop: record.monitoring.workingStop,
            targetReached: null,
            quantityPctClosed: null,
            reason: "Incomplete ticks with conflicting OHLC levels — ENTRY_SEQUENCE_AMBIGUOUS",
            priceSource: bar.source ?? "tradingview-ohlcv"
          });
          record.finalResult = {
            outcome: "AMBIGUOUS",
            exitReason: "Incomplete ordered ticks with conflicting OHLC levels",
            exitTimestamp: bar.barTime,
            exitPrice: null,
            entryPrice: null,
            holdingDurationMs: null,
            grossPoints: null,
            estimatedSpread: null,
            estimatedSlippage: null,
            estimatedFees: null,
            netPoints: null,
            percentageResult: null,
            grossR: null,
            netR: null,
            mfe: null,
            mae: null,
            targetsReached: [],
            dataQualityAtEntry: snap.dataQuality,
            dataQualityAtExit: bar.dataQuality ?? "OK",
            label: HYPOTHETICAL_LABEL,
            disclaimer: HYPOTHETICAL_DISCLAIMER
          };
          markBarApplied(record, bar);
          return record;
        }
        record.monitoring.currentPrice = bar.close;
        record.monitoring.latestMarketDataTimestamp = bar.barTime;
        record.monitoring.lastMonitoringAt = nowIso();
        markBarApplied(record, bar);
        return record;
      }

      // Ignore pre-entry stop/target ticks; enter at first valid entry tick.
      const fill = fillPrice(snap);
      if (fill == null) {
        markBarApplied(record, bar);
        return record;
      }
      applyEntryFill(
        record,
        bar,
        fill,
        "Hypothetical entry — ordered ticks; pre-entry stop/target ignored"
      );
      const closed = applyPostEntryTicks(record, bar, sortedTicks, entryTickIndex);
      markBarApplied(record, bar);
      if (closed) return record;
      return record;
    }

    if (entryTouched(snap, bar)) {
      const fill = fillPrice(snap);
      if (fill == null) {
        markBarApplied(record, bar);
        return record;
      }

      const conflict = conflictingExitInBar(snap, bar);

      if (conflict.stopInRange && conflict.targetInRange) {
        // Rule A: entry + stop + TP in one OHLC candle without ordered data.
        record.monitoring.lifecycle = "ENTRY_SEQUENCE_AMBIGUOUS";
        record.ambiguity = {
          candleTimestamp: bar.barTime,
          candleHigh: bar.high,
          candleLow: bar.low,
          stop: snap.stopLoss!,
          target: snap.tp1 ?? snap.tp2 ?? snap.tp3!,
          missingDataRequired: "ordered intrabar/tick data to resolve entry vs stop vs target"
        };
        pushEvent(record, {
          type: "ENTRY_SEQUENCE_AMBIGUOUS",
          barTime: bar.barTime,
          price: bar.close,
          oldStop: record.monitoring.workingStop,
          newStop: record.monitoring.workingStop,
          targetReached: null,
          quantityPctClosed: null,
          reason:
            "Entry+stop+target in same candle without ordered data — ENTRY_SEQUENCE_AMBIGUOUS",
          priceSource: bar.source ?? "tradingview-ohlcv"
        });
        record.finalResult = {
          outcome: "AMBIGUOUS",
          exitReason: "Entry sequence ambiguous — no win/loss inferred from OHLC alone",
          exitTimestamp: bar.barTime,
          exitPrice: null,
          entryPrice: null,
          holdingDurationMs: null,
          grossPoints: null,
          estimatedSpread: null,
          estimatedSlippage: null,
          estimatedFees: null,
          netPoints: null,
          percentageResult: null,
          grossR: null,
          netR: null,
          mfe: null,
          mae: null,
          targetsReached: [],
          dataQualityAtEntry: snap.dataQuality,
          dataQualityAtExit: bar.dataQuality ?? "OK",
          label: HYPOTHETICAL_LABEL,
          disclaimer: HYPOTHETICAL_DISCLAIMER
        };
        markBarApplied(record, bar);
        return record;
      } else if (conflict.stopInRange || conflict.targetInRange) {
        // Rule B: record entry only; begin stop/target evaluation on the next candle.
        applyEntryFill(
          record,
          bar,
          fill,
          "Hypothetical entry — exit levels also in range; stop/TP deferred to next candle"
        );
        pushEvent(record, {
          type: "ENTRY_SEQUENCE_DEFERRED",
          barTime: bar.barTime,
          price: fill,
          oldStop: record.monitoring.workingStop,
          newStop: record.monitoring.workingStop,
          targetReached: null,
          quantityPctClosed: null,
          reason:
            "Entry recorded without same-candle stop/TP award — no win bias from OHLC sequence",
          priceSource: bar.source ?? "tradingview-ohlcv"
        });
        markBarApplied(record, bar);
        return record;
      } else {
        applyEntryFill(
          record,
          bar,
          fill,
          "Hypothetical entry — frozen plan fill at proposed entry (not best-of-candle)"
        );
        // No conflicting exits in range — safe to continue open path on same bar.
      }
    } else if (seen >= maxBars) {
      record.entry.expiredWithoutEntry = true;
      record.monitoring.lifecycle = "EXPIRED";
      record.finalResult = {
        outcome: "EXPIRED",
        exitReason: "Pending entry expired without fill",
        exitTimestamp: bar.barTime,
        exitPrice: null,
        entryPrice: null,
        holdingDurationMs: null,
        grossPoints: null,
        estimatedSpread: null,
        estimatedSlippage: null,
        estimatedFees: null,
        netPoints: null,
        percentageResult: null,
        grossR: null,
        netR: null,
        mfe: null,
        mae: null,
        targetsReached: [],
        dataQualityAtEntry: null,
        dataQualityAtExit: bar.dataQuality ?? "OK",
        label: HYPOTHETICAL_LABEL,
        disclaimer: HYPOTHETICAL_DISCLAIMER
      };
      pushEvent(record, {
        type: "EXPIRE",
        barTime: bar.barTime,
        price: bar.close,
        oldStop: null,
        newStop: null,
        targetReached: null,
        quantityPctClosed: null,
        reason: "Entry not reached within max pending bars",
        priceSource: bar.source ?? "tradingview-ohlcv"
      });
      markBarApplied(record, bar);
      return record;
    } else {
      record.monitoring.currentPrice = bar.close;
      record.monitoring.latestMarketDataTimestamp = bar.barTime;
      record.monitoring.lastMonitoringAt = nowIso();
      markBarApplied(record, bar);
      return record;
    }
  }

  // OPEN / TP partial states
  if (
    record.monitoring.lifecycle === "OPEN" ||
    record.monitoring.lifecycle === "TP1_HIT" ||
    record.monitoring.lifecycle === "TP2_HIT" ||
    record.monitoring.lifecycle === "BREAKEVEN"
  ) {
    record.monitoring.currentPrice = bar.close;
    record.monitoring.latestMarketDataTimestamp = bar.barTime;
    record.monitoring.lastMonitoringAt = nowIso();
    if (record.entry.entryTimestamp) {
      record.monitoring.timeInTradeMs = Math.max(
        0,
        new Date(bar.barTime).getTime() - new Date(record.entry.entryTimestamp).getTime()
      );
    }
    updateExcursion(record, bar);
    const entry = record.entry.entryPrice!;
    const gross = pointsFrom(direction, entry, bar.close);
    // Mark-to-market includes already-realized weighted legs + remaining open notionals.
    const realizedGross = record.exitLegs.reduce((s, l) => s + l.grossPointsContribution, 0);
    const remainingFrac = record.monitoring.quantityRemainingPct / 100;
    record.monitoring.currentGrossPoints =
      Math.round((realizedGross + gross * remainingFrac) * 100) / 100;
    record.monitoring.currentNetPoints = record.monitoring.currentGrossPoints;
    record.monitoring.currentRMultiple = rFrom(
      record.monitoring.currentGrossPoints,
      snap.initialRiskDistance
    );

    // Prefer ordered ticks when present — ignore OHLC stop/TP conflict ambiguity.
    const openTicks = bar.orderedTicks;
    if (openTicks && openTicks.length > 0) {
      const sortedOpenTicks = [...openTicks].sort((a, b) => a.t - b.t);
      applyPostEntryTicks(record, bar, sortedOpenTicks, 0);
      markBarApplied(record, bar);
      return record;
    }

    const stopPrice = record.monitoring.workingStop;
    const targets: Array<{
      label: "TP1" | "TP2" | "TP3";
      price: number | null;
      statusKey: "tp1Status" | "tp2Status" | "tp3Status";
    }> = [
      { label: "TP1", price: snap.tp1, statusKey: "tp1Status" },
      { label: "TP2", price: snap.tp2, statusKey: "tp2Status" },
      { label: "TP3", price: snap.tp3, statusKey: "tp3Status" }
    ];

    const pendingTargets = targets.filter(
      (t) => t.price != null && record.monitoring[t.statusKey] === "PENDING"
    );
    const stopWouldHit = stopPrice != null && stopHit(direction, stopPrice, bar);
    const targetsWouldHit = pendingTargets.filter((t) => targetHit(direction, t.price!, bar));

    if (stopWouldHit && targetsWouldHit.length > 0) {
      const ambiguity: AmbiguityRecord = {
        candleTimestamp: bar.barTime,
        candleHigh: bar.high,
        candleLow: bar.low,
        stop: stopPrice,
        target: targetsWouldHit[0]!.price!,
        missingDataRequired: "tick-level or ordered intrabar data to resolve stop vs target sequence"
      };
      record.ambiguity = ambiguity;
      const remaining = record.monitoring.quantityRemainingPct;
      const contrib = buildLegContributions(record, remaining, stopPrice);
      addExitLeg(record, {
        reason: "AMBIGUOUS",
        quantityPct: remaining,
        exitPrice: stopPrice,
        barTime: bar.barTime,
        ...contrib
      });
      pushEvent(record, {
        type: "AMBIGUOUS",
        barTime: bar.barTime,
        price: bar.close,
        oldStop: stopPrice,
        newStop: stopPrice,
        targetReached: null,
        quantityPctClosed: remaining,
        reason: "Same-candle stop and target — AMBIGUOUS_INTRABAR (excluded from win rate)",
        priceSource: bar.source ?? "tradingview-ohlcv"
      });
      finalizeFromExitLegs(
        record,
        "AMBIGUOUS_INTRABAR",
        bar,
        "Ambiguous intrabar — not classified as win",
        targetsReachedList(record),
        true
      );
      markBarApplied(record, bar);
      return record;
    }

    if (stopWouldHit) {
      record.monitoring.stopStatus = "HIT";
      const remaining = record.monitoring.quantityRemainingPct;
      const isBe =
        record.monitoring.lifecycle === "BREAKEVEN" ||
        (record.entry.entryPrice != null && stopPrice === record.entry.entryPrice);
      const contrib = buildLegContributions(record, remaining, stopPrice);
      addExitLeg(record, {
        reason: isBe ? "BREAKEVEN" : "STOP",
        quantityPct: remaining,
        exitPrice: stopPrice,
        barTime: bar.barTime,
        ...contrib
      });
      pushEvent(record, {
        type: "STOP",
        barTime: bar.barTime,
        price: stopPrice,
        oldStop: stopPrice,
        newStop: stopPrice,
        targetReached: null,
        quantityPctClosed: remaining,
        reason: isBe ? "Stop hit at breakeven" : "Stop hit",
        priceSource: bar.source ?? "tradingview-ohlcv"
      });
      finalizeFromExitLegs(
        record,
        "STOP_HIT",
        bar,
        isBe ? "Stop loss hit at breakeven" : "Stop loss hit",
        targetsReachedList(record)
      );
      markBarApplied(record, bar);
      return record;
    }

    for (const t of targetsWouldHit) {
      record.monitoring[t.statusKey] = "HIT";
      const pct = t.label === "TP1" ? 40 : t.label === "TP2" ? 30 : 30;
      const closePct = Math.min(pct, record.monitoring.quantityRemainingPct);
      record.monitoring.quantityRemainingPct = Math.max(
        0,
        record.monitoring.quantityRemainingPct - closePct
      );
      record.monitoring.lifecycle =
        t.label === "TP1" ? "TP1_HIT" : t.label === "TP2" ? "TP2_HIT" : "TP3_HIT";

      const contrib = buildLegContributions(record, closePct, t.price!);
      addExitLeg(record, {
        reason: t.label,
        quantityPct: closePct,
        exitPrice: t.price!,
        barTime: bar.barTime,
        ...contrib
      });
      pushEvent(record, {
        type: t.label,
        barTime: bar.barTime,
        price: t.price,
        oldStop: record.monitoring.workingStop,
        newStop: record.monitoring.workingStop,
        targetReached: t.label,
        quantityPctClosed: closePct,
        reason: `${t.label} hit (hypothetical partial)`,
        priceSource: bar.source ?? "tradingview-ohlcv"
      });

      if (t.label === "TP1" && record.entry.entryPrice != null) {
        const old = record.monitoring.workingStop;
        record.monitoring.workingStop = record.entry.entryPrice;
        record.monitoring.stopStatus = "MOVED_BREAKEVEN";
        record.monitoring.lifecycle = "BREAKEVEN";
        pushEvent(record, {
          type: "BREAKEVEN_MOVE",
          barTime: bar.barTime,
          price: record.entry.entryPrice,
          oldStop: old,
          newStop: record.entry.entryPrice,
          targetReached: null,
          quantityPctClosed: null,
          reason: "Stop moved to breakeven after TP1 (audited management — snapshot stop unchanged)",
          priceSource: bar.source ?? "tradingview-ohlcv"
        });
      }

      if (t.label === "TP3" || record.monitoring.quantityRemainingPct <= 0) {
        finalizeFromExitLegs(
          record,
          t.label === "TP3" ? "TP3_HIT" : "CLOSED",
          bar,
          `${t.label} completed hypothetical trade`,
          targetsReachedList(record)
        );
        markBarApplied(record, bar);
        return record;
      }
    }
  }

  markBarApplied(record, bar);
  return record;
}

export function moveTrailingStop(
  record: SignalOutcomeRecord,
  newStop: number,
  barTime: string,
  reason: string
): SignalOutcomeRecord {
  if (record.snapshot.direction === "WAIT") return record;
  const old = record.monitoring.workingStop;
  record.monitoring.workingStop = newStop;
  record.monitoring.stopStatus = "TRAILED";
  pushEvent(record, {
    type: "TRAIL_STOP",
    barTime,
    price: newStop,
    oldStop: old,
    newStop,
    targetReached: null,
    quantityPctClosed: null,
    reason,
    priceSource: "strategy-management"
  });
  record.updatedAt = nowIso();
  return record;
}

export function invalidateSignal(
  record: SignalOutcomeRecord,
  barTime: string,
  reason: string
): SignalOutcomeRecord {
  if (
    record.monitoring.lifecycle === "CLOSED" ||
    record.monitoring.lifecycle === "CANCELLED" ||
    record.monitoring.lifecycle === "WAIT_ONLY"
  ) {
    return record;
  }
  record.monitoring.lifecycle = "CANCELLED";
  if (record.entry.entryReached && record.entry.entryPrice != null && record.monitoring.quantityRemainingPct > 0) {
    const exitPrice = record.monitoring.currentPrice ?? record.entry.entryPrice;
    const contrib = buildLegContributions(record, record.monitoring.quantityRemainingPct, exitPrice);
    addExitLeg(record, {
      reason: "INVALIDATION",
      quantityPct: record.monitoring.quantityRemainingPct,
      exitPrice,
      barTime,
      ...contrib
    });
  }
  pushEvent(record, {
    type: "INVALIDATION",
    barTime,
    price: record.monitoring.currentPrice,
    oldStop: record.monitoring.workingStop,
    newStop: record.monitoring.workingStop,
    targetReached: null,
    quantityPctClosed: record.monitoring.quantityRemainingPct,
    reason,
    priceSource: "strategy-invalidation"
  });
  if (record.exitLegs.length > 0) {
    finalizeFromExitLegs(
      record,
      "CANCELLED",
      {
        eventId: `invalidate-${barTime}`,
        barTime,
        open: 0,
        high: 0,
        low: 0,
        close: record.monitoring.currentPrice ?? 0,
        isConfirmedBar: true,
        symbol: record.snapshot.symbol,
        timeframe: record.snapshot.timeframe,
        environment: record.snapshot.environment
      },
      reason,
      targetsReachedList(record)
    );
    record.finalResult!.outcome = "CANCELLED";
    record.monitoring.lifecycle = "CANCELLED";
  } else {
    record.finalResult = {
      outcome: "CANCELLED",
      exitReason: reason,
      exitTimestamp: barTime,
      exitPrice: record.monitoring.currentPrice,
      entryPrice: record.entry.entryPrice,
      holdingDurationMs: record.monitoring.timeInTradeMs,
      grossPoints: record.monitoring.currentGrossPoints,
      estimatedSpread: record.entry.entrySpreadEstimate,
      estimatedSlippage: record.entry.entrySlippageEstimate,
      estimatedFees: 0,
      netPoints: record.monitoring.currentNetPoints,
      percentageResult: null,
      grossR: record.monitoring.currentRMultiple,
      netR: record.monitoring.currentRMultiple,
      mfe: record.monitoring.mfe,
      mae: record.monitoring.mae,
      targetsReached: targetsReachedList(record),
      dataQualityAtEntry: record.snapshot.dataQuality,
      dataQualityAtExit: "OK",
      label: HYPOTHETICAL_LABEL,
      disclaimer: HYPOTHETICAL_DISCLAIMER
    };
  }
  record.updatedAt = nowIso();
  return record;
}

/** Assert frozen snapshot fields are unchanged (for tests / immutability guards). */
export function assertSnapshotImmutable(
  original: SignalSnapshot,
  current: SignalSnapshot
): void {
  const keys: Array<keyof SignalSnapshot> = [
    "proposedEntryPrice",
    "stopLoss",
    "tp1",
    "tp2",
    "tp3",
    "direction",
    "confidence",
    "strategy",
    "reasons",
    "entryZoneLow",
    "entryZoneHigh"
  ];
  for (const k of keys) {
    if (JSON.stringify(original[k]) !== JSON.stringify(current[k])) {
      throw new Error(`Snapshot field ${k} was mutated`);
    }
  }
}
