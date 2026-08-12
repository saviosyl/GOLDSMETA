/**
 * Demo-only T1/T2/T3 profit-lock manager.
 * Executes evaluateProfitLock plans with broker reconcile + exactly-once safety.
 * Live accounts produce ZERO mutations.
 */

import type { DemoPositionLifecycle } from "./positionLifecycleTypes";
import { appendLifecycleEvent } from "./positionLifecycleTypes";
import {
  canAdvanceProfitLockStage,
  emptyProfitLockState,
  maxProtectionLevel,
  type ProfitLockStage
} from "./demoProfitLockTypes";
import {
  evaluateProfitLock,
  m5CloseConfirmsContinuation,
  type ProfitLockAction
} from "./demoProfitLockEvaluate";
import { brokerClosedLots } from "./demoProfitLockVolume";
import {
  isCTraderLiveEnabled,
  isBrokerExecutionEnabled
} from "./flags";
import type { BrokerOpenPosition, TrendbarCandle } from "./openApiClient";
import type { BrokerSymbol } from "../domain";

export type ProfitLockMutationCounters = {
  partialCloses: number;
  slAmends: number;
  tpAmends: number;
  positionCloses: number;
};

/** Minimal quote shape used for mid/spread in the ladder. */
export type ProfitLockQuote = {
  bid: number | null;
  ask: number | null;
  spread: number | null;
};

export type ProfitLockDeps = {
  reconcilePositions: (uid: string) => Promise<BrokerOpenPosition[]>;
  amendStopLoss: (args: {
    ownerUid: string;
    positionId: string;
    stopLoss: number;
    takeProfit?: number | null;
  }) => Promise<{ accepted: boolean }>;
  closePosition: (args: {
    ownerUid: string;
    positionId: string;
    volumeUnits: number;
  }) => Promise<{ accepted: boolean }>;
  loadSymbol: (uid: string) => Promise<BrokerSymbol | null>;
  getQuote: (uid: string) => Promise<ProfitLockQuote | null>;
  /**
   * Completed (not forming) M5 bars, newest last.
   * Injected in tests; production loads via trendbars.
   */
  getCompletedM5Bars: (uid: string) => Promise<TrendbarCandle[]>;
  /** Connection facts for Live hard-lock. */
  isSelectedAccountLive: (uid: string) => Promise<boolean>;
  save: (doc: DemoPositionLifecycle) => Promise<void>;
  nowIso?: () => string;
};

function nowIsoDefault() {
  return new Date().toISOString();
}

function withStage(
  doc: DemoPositionLifecycle,
  stage: ProfitLockStage,
  extras?: Partial<DemoPositionLifecycle>
): DemoPositionLifecycle {
  if (
    doc.profitLockStage != null &&
    !canAdvanceProfitLockStage(doc.profitLockStage, stage)
  ) {
    return { ...doc, ...extras, updatedAt: nowIsoDefault() };
  }
  return {
    ...doc,
    ...extras,
    profitLockStage: stage,
    managementState: mapStageToManagementState(stage, doc),
    updatedAt: nowIsoDefault()
  };
}

function mapStageToManagementState(
  stage: ProfitLockStage,
  doc: DemoPositionLifecycle
): DemoPositionLifecycle["managementState"] {
  switch (stage) {
    case "T1_SECURED_BE":
      return "BREAKEVEN_SET";
    case "T1_TRIGGERED":
    case "T1_PARTIAL_DONE_SL_PENDING":
    case "T1_CONTINUATION_CONFIRMED":
    case "T1_PROTECTED":
      return "TP1_HIT";
    case "T2_TRIGGERED":
    case "T2_PARTIAL_DONE":
    case "T2_SECURED":
    case "T2_CONTINUATION_CONFIRMED":
    case "T2_PROTECTED":
      return "TP2_HIT";
    case "T3_TRIGGERED":
      return "TP3_HIT";
    case "CLOSE_RECONCILIATION_PENDING":
      return "CLOSE_RECONCILIATION_PENDING";
    case "CLOSED":
      return "CLOSED";
    default:
      return doc.managementState === "HOLD" ? "SL_PROTECTED" : doc.managementState;
  }
}

export function ensureProfitLockInitialized(
  doc: DemoPositionLifecycle
): DemoPositionLifecycle {
  if (doc.profitLockStage != null) return doc;
  const base = emptyProfitLockState();
  return {
    ...doc,
    ...base,
    profitLockStage: "OPEN",
    brokerHardTakeProfit:
      doc.tp3 != null && Number.isFinite(doc.tp3) ? doc.tp3 : null,
    cumulativeClosedLots: 0,
    updatedAt: nowIsoDefault()
  };
}

/**
 * Run one profit-lock management pass for an open Demo lifecycle doc.
 * Returns updated doc + mutation counters (for Live zero-mutation tests).
 */
export async function runDemoProfitLockPass(
  docIn: DemoPositionLifecycle,
  deps: ProfitLockDeps
): Promise<{
  doc: DemoPositionLifecycle;
  mutations: ProfitLockMutationCounters;
  action: ProfitLockAction | null;
  blockedReason: string | null;
}> {
  const mutations: ProfitLockMutationCounters = {
    partialCloses: 0,
    slAmends: 0,
    tpAmends: 0,
    positionCloses: 0
  };
  const stamp = deps.nowIso ?? nowIsoDefault;

  // Hard Live locks — ZERO mutations.
  if (isCTraderLiveEnabled() || isBrokerExecutionEnabled()) {
    return {
      doc: docIn,
      mutations,
      action: null,
      blockedReason: "LIVE_EXECUTION_LOCKED"
    };
  }
  if (await deps.isSelectedAccountLive(docIn.uid)) {
    return {
      doc: {
        ...docIn,
        profitLockLastBlocker: "LIVE_ACCOUNT_MUTATION_DENIED",
        updatedAt: stamp()
      },
      mutations,
      action: null,
      blockedReason: "LIVE_ACCOUNT_MUTATION_DENIED"
    };
  }

  let doc = ensureProfitLockInitialized(docIn);
  if (doc.status !== "OPEN" && doc.status !== "CLOSE_RECONCILIATION_PENDING") {
    return { doc, mutations, action: null, blockedReason: "NOT_OPEN" };
  }

  let brokerPositions: BrokerOpenPosition[] = [];
  try {
    brokerPositions = await deps.reconcilePositions(doc.uid);
  } catch {
    return {
      doc: { ...doc, profitLockLastBlocker: "RECONCILE_FAILED", updatedAt: stamp() },
      mutations,
      action: null,
      blockedReason: "RECONCILE_FAILED"
    };
  }

  const match = doc.brokerPositionId
    ? brokerPositions.find((p) => p.positionId === doc.brokerPositionId)
    : undefined;

  const quote = await deps.getQuote(doc.uid).catch(() => null);
  const mid =
    quote?.bid != null && quote?.ask != null
      ? (quote.bid + quote.ask) / 2
      : match?.entryPrice ?? doc.currentPrice;

  const originalLots = doc.lots ?? 0;
  const brokerRemaining = match?.volumeLots ?? 0;
  doc = {
    ...doc,
    currentPrice: mid ?? doc.currentPrice,
    currentSl: match?.stopLoss ?? doc.currentSl,
    remainingLots: match ? brokerRemaining : doc.remainingLots,
    cumulativeClosedLots: match
      ? brokerClosedLots(originalLots, brokerRemaining)
      : doc.cumulativeClosedLots,
    unrealisedPnl: match?.unrealisedPnl ?? doc.unrealisedPnl
  };

  const symbol = await deps.loadSymbol(doc.uid).catch(() => null);
  if (
    !symbol ||
    symbol.minVolume == null ||
    symbol.maxVolume == null ||
    symbol.volumeStep == null
  ) {
    doc = { ...doc, profitLockLastBlocker: "VOLUME_METADATA_UNAVAILABLE", updatedAt: stamp() };
    await deps.save(doc);
    return {
      doc,
      mutations,
      action: null,
      blockedReason: "VOLUME_METADATA_UNAVAILABLE"
    };
  }

  const bars = await deps.getCompletedM5Bars(doc.uid).catch(() => []);
  const lastCompleted = bars.length > 0 ? bars[bars.length - 1] : null;
  const m5Close = lastCompleted?.close ?? null;
  const m5Time = lastCompleted?.time ?? null;

  const action = evaluateProfitLock({
    side: doc.side,
    stage: doc.profitLockStage ?? "OPEN",
    protectionLevel: doc.profitLockProtectionLevel ?? "NONE",
    entry: doc.entry,
    currentSl: doc.currentSl,
    tp1: doc.tp1,
    tp2: doc.tp2,
    tp3: doc.tp3,
    brokerHardTakeProfit: doc.brokerHardTakeProfit,
    originalLots,
    brokerRemainingLots: match ? brokerRemaining : 0,
    currentPrice: mid ?? null,
    brokerPositionOpen: Boolean(match),
    m5ContinuationBeyondTp1: m5CloseConfirmsContinuation({
      side: doc.side,
      completedClose: m5Close,
      level: doc.tp1
    }),
    m5ContinuationBeyondTp2: m5CloseConfirmsContinuation({
      side: doc.side,
      completedClose: m5Close,
      level: doc.tp2
    }),
    completedM5BarTime: m5Time,
    t1ContinuationBarTime: doc.t1ContinuationBarTime,
    t2ContinuationBarTime: doc.t2ContinuationBarTime,
    volumeRules: {
      minLots: symbol.minVolume,
      maxLots: symbol.maxVolume,
      stepLots: symbol.volumeStep
    },
    stopBuffer: {
      minStopDistance: symbol.minStopDistance,
      spread: quote?.spread ?? null,
      tickSize: symbol.tickSize,
      digits: symbol.digits
    }
  });

  if (action.type === "NONE") {
    doc = {
      ...doc,
      profitLockLastBlocker: action.reason,
      lastRecommendation: `PROFIT_LOCK:${action.reason}`,
      updatedAt: stamp()
    };
    await deps.save(doc);
    return { doc, mutations, action, blockedReason: action.reason };
  }

  if (action.type === "ADVANCE_STAGE") {
    const ev = appendLifecycleEvent(doc, {
      at: stamp(),
      kind: "RECOMMENDATION",
      reason: `PROFIT_LOCK advance → ${action.nextStage}: ${action.reason}`,
      dedupeKey: `profit_lock:advance:${action.nextStage}:${action.reason}`
    });
    doc = withStage(ev.applied ? ev.doc : doc, action.nextStage, {
      profitLockProtectionLevel: action.nextProtection
        ? maxProtectionLevel(
            doc.profitLockProtectionLevel ?? "NONE",
            action.nextProtection
          )
        : doc.profitLockProtectionLevel,
      t1ContinuationBarTime:
        action.t1ContinuationBarTime ?? doc.t1ContinuationBarTime,
      t2ContinuationBarTime:
        action.t2ContinuationBarTime ?? doc.t2ContinuationBarTime,
      profitLockLastBlocker: null,
      lastRecommendation: `PROFIT_LOCK:${action.reason}`
    });
    await deps.save(doc);
    return { doc, mutations, action, blockedReason: null };
  }

  if (action.type === "RECONCILE_CLOSED") {
    const ev = appendLifecycleEvent(doc, {
      at: stamp(),
      kind: "CLOSE_PENDING",
      reason: `PROFIT_LOCK: ${action.reason}`,
      dedupeKey: `profit_lock:reconcile_closed:${doc.correlationId}`
    });
    doc = withStage(ev.applied ? ev.doc : doc, action.nextStage, {
      status: "CLOSE_RECONCILIATION_PENDING",
      profitLockLastBlocker: null,
      lastRecommendation: `PROFIT_LOCK:${action.reason}`
    });
    await deps.save(doc);
    return { doc, mutations, action, blockedReason: null };
  }

  if (action.type === "PARTIAL_CLOSE") {
    if (!doc.brokerPositionId) {
      return {
        doc: { ...doc, profitLockLastBlocker: "NO_BROKER_POSITION_ID", updatedAt: stamp() },
        mutations,
        action,
        blockedReason: "NO_BROKER_POSITION_ID"
      };
    }
    // Re-check broker volume immediately before close (crash/restart safety).
    const fresh = await deps.reconcilePositions(doc.uid).catch(() => brokerPositions);
    const freshMatch = fresh.find((p) => p.positionId === doc.brokerPositionId);
    if (!freshMatch) {
      const ev = appendLifecycleEvent(doc, {
        at: stamp(),
        kind: "CLOSE_PENDING",
        reason: "PROFIT_LOCK: broker flat before partial — no second close",
        dedupeKey: `profit_lock:flat_before_${action.tag}:${doc.correlationId}`
      });
      doc = withStage(ev.applied ? ev.doc : doc, "CLOSE_RECONCILIATION_PENDING", {
        status: "CLOSE_RECONCILIATION_PENDING"
      });
      await deps.save(doc);
      return { doc, mutations, action, blockedReason: "BROKER_ALREADY_FLAT" };
    }
    const freshRemaining = freshMatch.volumeLots ?? 0;
    const already = brokerClosedLots(originalLots, freshRemaining);
    if (
      action.tag !== "T3_REMAINDER" &&
      already + 1e-8 >= action.desiredCumulativeLots
    ) {
      const ev = appendLifecycleEvent(doc, {
        at: stamp(),
        kind: "IDEMPOTENT_SKIP",
        reason: `PROFIT_LOCK: ${action.tag} already satisfied by broker volume`,
        brokerAck: true,
        dedupeKey: `${action.dedupeKey}:idempotent`
      });
      doc = withStage(ev.applied ? ev.doc : doc, action.nextStage, {
        remainingLots: freshRemaining,
        cumulativeClosedLots: already,
        tp1Status:
          action.tag === "T1" ? "PARTIAL_CLOSED" : doc.tp1Status,
        tp2Status:
          action.tag === "T2" ? "PARTIAL_CLOSED" : doc.tp2Status,
        intendedT1CloseLots:
          action.tag === "T1" ? action.lots : doc.intendedT1CloseLots,
        intendedT2CloseLots:
          action.tag === "T2" ? action.lots : doc.intendedT2CloseLots,
        profitLockLastBlocker: null
      });
      await deps.save(doc);
      return { doc, mutations, action, blockedReason: null };
    }

    if (doc.appliedDedupeKeys.includes(action.dedupeKey)) {
      // Dedupe key present but stage not advanced — trust broker reconcile path above next tick.
      doc = withStage(doc, action.nextStage, {
        remainingLots: freshRemaining,
        cumulativeClosedLots: already,
        profitLockLastBlocker: "DEDUPE_KEY_PRESENT_ADVANCE"
      });
      await deps.save(doc);
      return { doc, mutations, action, blockedReason: null };
    }

    try {
      const result = await deps.closePosition({
        ownerUid: doc.uid,
        positionId: doc.brokerPositionId,
        volumeUnits: action.volumeUnits
      });
      mutations.partialCloses += 1;
      if (action.tag === "T3_REMAINDER") mutations.positionCloses += 1;
      if (!result.accepted) {
        doc = {
          ...doc,
          profitLockLastBlocker: `${action.tag}_CLOSE_NOT_ACCEPTED`,
          updatedAt: stamp()
        };
        await deps.save(doc);
        return {
          doc,
          mutations,
          action,
          blockedReason: `${action.tag}_CLOSE_NOT_ACCEPTED`
        };
      }
      const after = await deps.reconcilePositions(doc.uid).catch(() => fresh);
      const afterMatch = after.find((p) => p.positionId === doc.brokerPositionId);
      const rem = afterMatch?.volumeLots ?? Math.max(0, freshRemaining - action.lots);
      const closed = brokerClosedLots(originalLots, rem);
      const ev = appendLifecycleEvent(doc, {
        at: stamp(),
        kind: "PARTIAL_CLOSE",
        reason: `PROFIT_LOCK ${action.tag} close ${action.lots} lots (cumulative target ${action.desiredCumulativeLots})`,
        brokerAck: true,
        dedupeKey: action.dedupeKey
      });
      doc = withStage(ev.doc, action.nextStage, {
        remainingLots: rem,
        cumulativeClosedLots: closed,
        tp1Status: action.tag === "T1" ? "PARTIAL_CLOSED" : doc.tp1Status,
        tp2Status: action.tag === "T2" ? "PARTIAL_CLOSED" : doc.tp2Status,
        tp3Status: action.tag === "T3_REMAINDER" ? "HIT" : doc.tp3Status,
        intendedT1CloseLots:
          action.tag === "T1" ? action.lots : doc.intendedT1CloseLots,
        intendedT2CloseLots:
          action.tag === "T2" ? action.lots : doc.intendedT2CloseLots,
        status:
          action.nextStage === "CLOSE_RECONCILIATION_PENDING"
            ? "CLOSE_RECONCILIATION_PENDING"
            : doc.status,
        profitLockLastBlocker: null,
        lastRecommendation: `PROFIT_LOCK:${action.tag}_CLOSED`
      });
      await deps.save(doc);
      return { doc, mutations, action, blockedReason: null };
    } catch (err) {
      doc = {
        ...doc,
        profitLockLastBlocker: `PARTIAL_CLOSE_ERROR:${
          err instanceof Error ? err.message : "unknown"
        }`,
        updatedAt: stamp()
      };
      await deps.save(doc);
      return {
        doc,
        mutations,
        action,
        blockedReason: "PARTIAL_CLOSE_ERROR"
      };
    }
  }

  if (action.type === "AMEND_SL") {
    if (!doc.brokerPositionId) {
      return {
        doc: { ...doc, profitLockLastBlocker: "NO_BROKER_POSITION_ID", updatedAt: stamp() },
        mutations,
        action,
        blockedReason: "NO_BROKER_POSITION_ID"
      };
    }
    if (doc.appliedDedupeKeys.includes(action.dedupeKey)) {
      doc = withStage(doc, action.nextStage, {
        profitLockProtectionLevel: maxProtectionLevel(
          doc.profitLockProtectionLevel ?? "NONE",
          action.nextProtection
        ),
        profitLockLastBlocker: null
      });
      await deps.save(doc);
      return { doc, mutations, action, blockedReason: null };
    }
    try {
      const oldSl = doc.currentSl;
      const result = await deps.amendStopLoss({
        ownerUid: doc.uid,
        positionId: doc.brokerPositionId,
        stopLoss: action.stopLoss,
        // Preserve TP3 — never rewrite to TP1.
        takeProfit: action.takeProfit ?? null
      });
      mutations.slAmends += 1;
      if (action.takeProfit != null) mutations.tpAmends += 1;
      if (!result.accepted) {
        doc = {
          ...doc,
          profitLockLastBlocker: "SL_AMEND_NOT_ACCEPTED",
          updatedAt: stamp()
        };
        await deps.save(doc);
        return {
          doc,
          mutations,
          action,
          blockedReason: "SL_AMEND_NOT_ACCEPTED"
        };
      }
      const ev = appendLifecycleEvent(doc, {
        at: stamp(),
        kind: action.nextProtection === "BE" ? "BREAKEVEN" : "SL_AMENDED",
        reason: `PROFIT_LOCK: ${action.reason} (preserve TP3=${action.takeProfit ?? "omit"})`,
        oldSl,
        newSl: action.stopLoss,
        brokerAck: true,
        dedupeKey: action.dedupeKey
      });
      doc = withStage(ev.doc, action.nextStage, {
        currentSl: action.stopLoss,
        profitLockProtectionLevel: maxProtectionLevel(
          doc.profitLockProtectionLevel ?? "NONE",
          action.nextProtection
        ),
        currentRisk:
          action.nextProtection === "BE" ||
          action.nextProtection === "TP1" ||
          action.nextProtection === "TP2"
            ? 0
            : doc.currentRisk,
        profitLockLastBlocker: null,
        lastRecommendation: `PROFIT_LOCK:${action.reason}`
      });
      await deps.save(doc);
      return { doc, mutations, action, blockedReason: null };
    } catch (err) {
      // Partial succeeded earlier; only retry SL next pass.
      doc = {
        ...doc,
        profitLockLastBlocker: `SL_AMEND_ERROR:${
          err instanceof Error ? err.message : "unknown"
        }`,
        updatedAt: stamp()
      };
      await deps.save(doc);
      return { doc, mutations, action, blockedReason: "SL_AMEND_ERROR" };
    }
  }

  return { doc, mutations, action: null, blockedReason: "UNHANDLED_ACTION" };
}
