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
    timeframe: decision.timeframe,
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

const pointsFrom = (direction: "BUY" | "SELL", entry: number, exit: number): number =>
  Math.round(((direction === "BUY" ? exit - entry : entry - exit) + Number.EPSILON) * 100) / 100;

const rFrom = (points: number, risk: number | null): number | null => {
  if (risk == null || risk <= 0) return null;
  return Math.round((points / risk) * 100) / 100;
};

function entryTouched(snapshot: SignalSnapshot, bar: SignalBarInput): boolean {
  if (snapshot.direction !== "BUY" && snapshot.direction !== "SELL") return false;
  const low = snapshot.entryZoneLow ?? snapshot.proposedEntryPrice;
  const high = snapshot.entryZoneHigh ?? snapshot.proposedEntryPrice;
  if (low == null || high == null) return false;
  // Deterministic: bar must trade through the zone/price (not assume best fill).
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

function closeTrade(
  record: SignalOutcomeRecord,
  lifecycle: SignalLifecycle,
  outcome: NonNullable<SignalOutcomeRecord["finalResult"]>["outcome"],
  exitPrice: number,
  bar: SignalBarInput,
  reason: string,
  targetsReached: Array<"TP1" | "TP2" | "TP3">
): void {
  const entryPrice = record.entry.entryPrice!;
  const direction = record.snapshot.direction as "BUY" | "SELL";
  const gross = pointsFrom(direction, entryPrice, exitPrice);
  const spread = record.entry.entrySpreadEstimate ?? 0;
  const slip = record.entry.entrySlippageEstimate ?? 0;
  const fees = 0;
  const net = Math.round((gross - spread - slip - fees) * 100) / 100;
  const risk = record.snapshot.initialRiskDistance;
  const holding =
    record.entry.entryTimestamp != null
      ? Math.max(0, new Date(bar.barTime).getTime() - new Date(record.entry.entryTimestamp).getTime())
      : null;

  record.monitoring.lifecycle = lifecycle === "AMBIGUOUS_INTRABAR" ? "AMBIGUOUS_INTRABAR" : "CLOSED";
  if (lifecycle !== "AMBIGUOUS_INTRABAR" && lifecycle !== "CLOSED") {
    record.monitoring.lifecycle = lifecycle;
  }
  record.finalResult = {
    outcome,
    exitReason: reason,
    exitTimestamp: bar.barTime,
    exitPrice,
    entryPrice,
    holdingDurationMs: holding,
    grossPoints: gross,
    estimatedSpread: spread,
    estimatedSlippage: slip,
    estimatedFees: fees,
    netPoints: net,
    percentageResult:
      entryPrice !== 0 ? Math.round(((net / entryPrice) * 10000)) / 100 : null,
    grossR: rFrom(gross, risk),
    netR: rFrom(net, risk),
    mfe: record.monitoring.mfe,
    mae: record.monitoring.mae,
    targetsReached,
    dataQualityAtEntry: record.snapshot.dataQuality,
    dataQualityAtExit: bar.dataQuality ?? "OK",
    label: HYPOTHETICAL_LABEL,
    disclaimer: HYPOTHETICAL_DISCLAIMER
  };
  record.updatedAt = nowIso();
}

function updateExcursion(record: SignalOutcomeRecord, bar: SignalBarInput): void {
  const entry = record.entry.entryPrice;
  if (entry == null || (record.snapshot.direction !== "BUY" && record.snapshot.direction !== "SELL")) {
    return;
  }
  const dir = record.snapshot.direction;
  const fav = dir === "BUY" ? bar.high : -bar.low;
  const adv = dir === "BUY" ? -bar.low : bar.high;
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
  void fav;
  void adv;
}

/**
 * Apply one confirmed bar. Idempotent on eventId.
 * Returns the same object reference mutated, or unchanged if skipped.
 */
export function applyBarToSignalOutcome(
  record: SignalOutcomeRecord,
  bar: SignalBarInput,
  opts: { maxPendingBars?: number; pendingBarsSeen?: number } = {}
): SignalOutcomeRecord {
  if (record.appliedBarEventIds.includes(bar.eventId)) {
    return record;
  }
  // Out-of-order: if we already have a later bar applied via lastMonitoringAt, still accept
  // only if eventId is new — but skip if barTime is older than last applied monitoring on open trade
  // for safety we still process if event is new (idempotent by eventId only).

  if (
    record.monitoring.lifecycle === "WAIT_ONLY" ||
    record.monitoring.lifecycle === "CLOSED" ||
    record.monitoring.lifecycle === "EXPIRED" ||
    record.monitoring.lifecycle === "CANCELLED" ||
    record.monitoring.lifecycle === "AMBIGUOUS_INTRABAR" ||
    record.monitoring.lifecycle === "DATA_UNAVAILABLE"
  ) {
    record.appliedBarEventIds.push(bar.eventId);
    record.updatedAt = nowIso();
    return record;
  }

  if (!bar.isConfirmedBar) {
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
    // Preserve OPEN/PENDING for safe retry; do not fabricate hits.
    record.monitoring.lastMonitoringAt = nowIso();
    record.monitoring.latestMarketDataTimestamp = bar.barTime;
    record.appliedBarEventIds.push(bar.eventId);
    record.updatedAt = nowIso();
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
    record.appliedBarEventIds.push(bar.eventId);
    record.updatedAt = nowIso();
    return record;
  }

  const snap = record.snapshot;
  if (snap.direction !== "BUY" && snap.direction !== "SELL") {
    record.appliedBarEventIds.push(bar.eventId);
    return record;
  }
  const direction = snap.direction;

  // PENDING_ENTRY
  if (record.monitoring.lifecycle === "PENDING_ENTRY") {
    const maxBars = opts.maxPendingBars ?? 48;
    const seen = (opts.pendingBarsSeen ?? record.appliedBarEventIds.length) + 1;
    if (entryTouched(snap, bar)) {
      const fill = fillPrice(snap);
      if (fill == null) {
        record.appliedBarEventIds.push(bar.eventId);
        return record;
      }
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
        reason: "Hypothetical entry — frozen plan fill at proposed entry (not best-of-candle)",
        priceSource: bar.source ?? "tradingview-ohlcv"
      });
      // Continue into open path on same bar (entry + target/stop same bar possible)
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
      record.appliedBarEventIds.push(bar.eventId);
      record.updatedAt = nowIso();
      return record;
    } else {
      record.monitoring.currentPrice = bar.close;
      record.monitoring.latestMarketDataTimestamp = bar.barTime;
      record.monitoring.lastMonitoringAt = nowIso();
      record.appliedBarEventIds.push(bar.eventId);
      record.updatedAt = nowIso();
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
    record.monitoring.currentGrossPoints = gross;
    record.monitoring.currentNetPoints = gross;
    record.monitoring.currentRMultiple = rFrom(gross, snap.initialRiskDistance);

    const stop = record.monitoring.workingStop;
    const targets: Array<{ label: "TP1" | "TP2" | "TP3"; price: number | null; statusKey: "tp1Status" | "tp2Status" | "tp3Status" }> =
      [
        { label: "TP1", price: snap.tp1, statusKey: "tp1Status" },
        { label: "TP2", price: snap.tp2, statusKey: "tp2Status" },
        { label: "TP3", price: snap.tp3, statusKey: "tp3Status" }
      ];

    const pendingTargets = targets.filter(
      (t) => t.price != null && record.monitoring[t.statusKey] === "PENDING"
    );
    const stopWouldHit = stop != null && stopHit(direction, stop, bar);
    const targetsWouldHit = pendingTargets.filter((t) => targetHit(direction, t.price!, bar));

    if (stopWouldHit && targetsWouldHit.length > 0) {
      const ambiguity: AmbiguityRecord = {
        candleTimestamp: bar.barTime,
        candleHigh: bar.high,
        candleLow: bar.low,
        stop: stop,
        target: targetsWouldHit[0]!.price!,
        missingDataRequired: "tick-level or ordered intrabar data to resolve stop vs target sequence"
      };
      record.ambiguity = ambiguity;
      record.monitoring.lifecycle = "AMBIGUOUS_INTRABAR";
      pushEvent(record, {
        type: "AMBIGUOUS",
        barTime: bar.barTime,
        price: bar.close,
        oldStop: stop,
        newStop: stop,
        targetReached: null,
        quantityPctClosed: null,
        reason: "Same-candle stop and target — AMBIGUOUS_INTRABAR (excluded from win rate)",
        priceSource: bar.source ?? "tradingview-ohlcv"
      });
      closeTrade(
        record,
        "AMBIGUOUS_INTRABAR",
        "AMBIGUOUS",
        stop,
        bar,
        "Ambiguous intrabar — not classified as win",
        []
      );
      record.appliedBarEventIds.push(bar.eventId);
      return record;
    }

    if (stopWouldHit) {
      record.monitoring.stopStatus = "HIT";
      pushEvent(record, {
        type: "STOP",
        barTime: bar.barTime,
        price: stop,
        oldStop: stop,
        newStop: stop,
        targetReached: null,
        quantityPctClosed: record.monitoring.quantityRemainingPct,
        reason: "Stop hit",
        priceSource: bar.source ?? "tradingview-ohlcv"
      });
      const targetsReached: Array<"TP1" | "TP2" | "TP3"> = [];
      if (record.monitoring.tp1Status === "HIT") targetsReached.push("TP1");
      if (record.monitoring.tp2Status === "HIT") targetsReached.push("TP2");
      if (record.monitoring.tp3Status === "HIT") targetsReached.push("TP3");
      const outcome =
        record.monitoring.lifecycle === "BREAKEVEN" ||
        (record.entry.entryPrice != null && stop === record.entry.entryPrice)
          ? "BREAKEVEN"
          : "LOSS";
      closeTrade(record, "STOP_HIT", outcome, stop, bar, "Stop loss hit", targetsReached);
      record.appliedBarEventIds.push(bar.eventId);
      return record;
    }

    for (const t of targetsWouldHit) {
      record.monitoring[t.statusKey] = "HIT";
      const pct = t.label === "TP1" ? 40 : t.label === "TP2" ? 30 : 30;
      record.monitoring.quantityRemainingPct = Math.max(
        0,
        record.monitoring.quantityRemainingPct - pct
      );
      record.monitoring.lifecycle =
        t.label === "TP1" ? "TP1_HIT" : t.label === "TP2" ? "TP2_HIT" : "TP3_HIT";
      pushEvent(record, {
        type: t.label,
        barTime: bar.barTime,
        price: t.price,
        oldStop: record.monitoring.workingStop,
        newStop: record.monitoring.workingStop,
        targetReached: t.label,
        quantityPctClosed: pct,
        reason: `${t.label} hit (hypothetical partial)`,
        priceSource: bar.source ?? "tradingview-ohlcv"
      });

      // After TP1: move stop to breakeven (management event — does not rewrite snapshot stop)
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
        const targetsReached: Array<"TP1" | "TP2" | "TP3"> = [];
        if (record.monitoring.tp1Status === "HIT") targetsReached.push("TP1");
        if (record.monitoring.tp2Status === "HIT") targetsReached.push("TP2");
        if (record.monitoring.tp3Status === "HIT") targetsReached.push("TP3");
        closeTrade(
          record,
          t.label === "TP3" ? "TP3_HIT" : record.monitoring.lifecycle,
          "WIN",
          t.price!,
          bar,
          `${t.label} completed hypothetical trade`,
          targetsReached
        );
        record.appliedBarEventIds.push(bar.eventId);
        return record;
      }
    }
  }

  record.appliedBarEventIds.push(bar.eventId);
  record.updatedAt = nowIso();
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
    targetsReached: [
      ...(record.monitoring.tp1Status === "HIT" ? (["TP1"] as const) : []),
      ...(record.monitoring.tp2Status === "HIT" ? (["TP2"] as const) : []),
      ...(record.monitoring.tp3Status === "HIT" ? (["TP3"] as const) : [])
    ],
    dataQualityAtEntry: record.snapshot.dataQuality,
    dataQualityAtExit: "OK",
    label: HYPOTHETICAL_LABEL,
    disclaimer: HYPOTHETICAL_DISCLAIMER
  };
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
