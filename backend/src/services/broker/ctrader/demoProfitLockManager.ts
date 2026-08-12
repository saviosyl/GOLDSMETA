/**
 * Demo-only T1/T2/T3 profit-lock manager.
 * Broker-confirmed volume/SL is authority — never advance on accepted=true alone.
 * Live accounts produce ZERO mutations.
 */

import type { DemoPositionLifecycle } from "./positionLifecycleTypes";
import { appendLifecycleEvent } from "./positionLifecycleTypes";
import {
  canAdvanceProfitLockStage,
  emptyProfitLockState,
  maxProtectionLevel,
  type PendingAmendIntent,
  type PendingCloseIntent,
  type ProfitLockStage
} from "./demoProfitLockTypes";
import {
  evaluateProfitLock,
  isFreshPostSecureM5Bar,
  m5CloseConfirmsContinuation,
  type ProfitLockAction
} from "./demoProfitLockEvaluate";
import { brokerClosedLots } from "./demoProfitLockVolume";
import {
  brokerSlConfirmsRequested,
  brokerTp3Preserved
} from "./demoProfitLockStops";
import { executableTargetTouchPrice } from "./demoProfitLockTargets";
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
  getCompletedM5Bars: (uid: string) => Promise<TrendbarCandle[]>;
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
    case "BE_AMEND_PENDING_RECONCILE":
      return "BREAKEVEN_SET";
    case "T1_TRIGGERED":
    case "T1_CLOSE_SUBMITTING":
    case "T1_CLOSE_PENDING_RECONCILE":
    case "T1_PARTIAL_DONE_SL_PENDING":
    case "T1_CONTINUATION_CONFIRMED":
    case "T1_PROTECT_AMEND_PENDING_RECONCILE":
    case "T1_PROTECTED":
      return "TP1_HIT";
    case "T2_TRIGGERED":
    case "T2_CLOSE_SUBMITTING":
    case "T2_CLOSE_PENDING_RECONCILE":
    case "T2_PARTIAL_DONE":
    case "T2_ENSURE_AMEND_PENDING_RECONCILE":
    case "T2_SECURED":
    case "T2_CONTINUATION_CONFIRMED":
    case "T2_PROTECT_AMEND_PENDING_RECONCILE":
    case "T2_PROTECTED":
      return "TP2_HIT";
    case "T3_TRIGGERED":
    case "T3_CLOSE_SUBMITTING":
    case "T3_CLOSE_PENDING_RECONCILE":
      return "TP3_HIT";
    case "CLOSE_RECONCILIATION_PENDING":
      return "CLOSE_RECONCILIATION_PENDING";
    case "CLOSED":
      return "CLOSED";
    default:
      return doc.managementState === "HOLD" ? "SL_PROTECTED" : doc.managementState;
  }
}

function lockedProfitDistance(
  side: "BUY" | "SELL",
  entry: number | null,
  sl: number | null
): number | null {
  if (entry == null || sl == null) return null;
  if (side === "BUY") {
    return sl > entry + 1e-12 ? Number((sl - entry).toFixed(8)) : null;
  }
  return sl < entry - 1e-12 ? Number((entry - sl).toFixed(8)) : null;
}

export function ensureProfitLockInitialized(
  doc: DemoPositionLifecycle
): DemoPositionLifecycle {
  if (doc.profitLockStage != null && doc.managementPolicy === "PROFIT_LOCK_V1") {
    return doc;
  }
  const base = emptyProfitLockState();
  return {
    ...doc,
    ...base,
    managementPolicy: "PROFIT_LOCK_V1",
    profitLockStage: doc.profitLockStage ?? "OPEN",
    brokerHardTakeProfit:
      doc.brokerHardTakeProfit ??
      (doc.tp3 != null && Number.isFinite(doc.tp3) ? doc.tp3 : null),
    cumulativeClosedLots: doc.cumulativeClosedLots ?? 0,
    updatedAt: nowIsoDefault()
  };
}

function cumulativeSatisfied(
  originalLots: number,
  brokerRemaining: number,
  desiredCumulative: number
): boolean {
  const closed = brokerClosedLots(originalLots, brokerRemaining);
  return closed + 1e-8 >= desiredCumulative || brokerRemaining <= 1e-8;
}

async function reconcileMatch(
  deps: ProfitLockDeps,
  uid: string,
  positionId: string | null
): Promise<BrokerOpenPosition | null | "RECONCILE_FAILED"> {
  if (!positionId) return null;
  try {
    const positions = await deps.reconcilePositions(uid);
    return positions.find((p) => p.positionId === positionId) ?? null;
  } catch {
    return "RECONCILE_FAILED";
  }
}

/**
 * Run one profit-lock management pass for an open Demo lifecycle doc.
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

  const matchOrFail = await reconcileMatch(
    deps,
    doc.uid,
    doc.brokerPositionId
  );
  if (matchOrFail === "RECONCILE_FAILED") {
    doc = {
      ...doc,
      profitLockLastBlocker: "RECONCILE_FAILED",
      updatedAt: stamp()
    };
    await deps.save(doc);
    return { doc, mutations, action: null, blockedReason: "RECONCILE_FAILED" };
  }

  const quote = await deps.getQuote(doc.uid).catch(() => null);
  const mid =
    quote?.bid != null && quote?.ask != null
      ? (quote.bid + quote.ask) / 2
      : matchOrFail?.entryPrice ?? doc.currentPrice;
  const touch = executableTargetTouchPrice({
    side: doc.side,
    bid: quote?.bid,
    ask: quote?.ask
  });

  const originalLots = doc.lots ?? 0;
  const brokerRemaining = matchOrFail?.volumeLots ?? 0;
  doc = {
    ...doc,
    currentPrice: mid ?? doc.currentPrice,
    currentSl: matchOrFail?.stopLoss ?? doc.currentSl,
    remainingLots: matchOrFail ? brokerRemaining : doc.remainingLots,
    cumulativeClosedLots: matchOrFail
      ? brokerClosedLots(originalLots, brokerRemaining)
      : doc.cumulativeClosedLots,
    unrealisedPnl: matchOrFail?.unrealisedPnl ?? doc.unrealisedPnl,
    lockedProfitDistance: lockedProfitDistance(
      doc.side,
      doc.entry,
      matchOrFail?.stopLoss ?? doc.currentSl
    )
  };

  // --- Pending close reconcile (broker volume is authority) ---
  if (
    doc.profitLockStage === "T1_CLOSE_SUBMITTING" ||
    doc.profitLockStage === "T1_CLOSE_PENDING_RECONCILE" ||
    doc.profitLockStage === "T2_CLOSE_SUBMITTING" ||
    doc.profitLockStage === "T2_CLOSE_PENDING_RECONCILE" ||
    doc.profitLockStage === "T3_CLOSE_SUBMITTING" ||
    doc.profitLockStage === "T3_CLOSE_PENDING_RECONCILE"
  ) {
    return reconcilePendingClose(doc, deps, mutations, stamp, matchOrFail);
  }

  // --- Pending SL amend reconcile ---
  if (
    doc.profitLockStage === "BE_AMEND_PENDING_RECONCILE" ||
    doc.profitLockStage === "T1_PROTECT_AMEND_PENDING_RECONCILE" ||
    doc.profitLockStage === "T2_ENSURE_AMEND_PENDING_RECONCILE" ||
    doc.profitLockStage === "T2_PROTECT_AMEND_PENDING_RECONCILE"
  ) {
    return reconcilePendingAmend(doc, deps, mutations, stamp, matchOrFail);
  }

  if (!matchOrFail) {
    const ev = appendLifecycleEvent(doc, {
      at: stamp(),
      kind: "CLOSE_PENDING",
      reason: "PROFIT_LOCK: broker flat — reconcile close, no second close",
      dedupeKey: `profit_lock:flat:${doc.correlationId}:${doc.profitLockStage}`
    });
    doc = withStage(ev.applied ? ev.doc : doc, "CLOSE_RECONCILIATION_PENDING", {
      status: "CLOSE_RECONCILIATION_PENDING",
      pendingClose: null,
      pendingAmend: null
    });
    await deps.save(doc);
    return {
      doc,
      mutations,
      action: { type: "RECONCILE_CLOSED", nextStage: "CLOSE_RECONCILIATION_PENDING", reason: "BROKER_POSITION_FLAT" },
      blockedReason: null
    };
  }

  const symbol = await deps.loadSymbol(doc.uid).catch(() => null);
  if (
    !symbol ||
    symbol.minVolume == null ||
    symbol.maxVolume == null ||
    symbol.volumeStep == null
  ) {
    doc = {
      ...doc,
      profitLockLastBlocker: "VOLUME_METADATA_UNAVAILABLE",
      updatedAt: stamp()
    };
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

  const freshT1 =
    isFreshPostSecureM5Bar({
      barTime: m5Time,
      securedAfterM5BarTime: doc.t1SecuredAfterM5BarTime,
      alreadyConfirmedBarTime: doc.t1ContinuationBarTime
    }) &&
    m5CloseConfirmsContinuation({
      side: doc.side,
      completedClose: m5Close,
      level: doc.tp1
    });
  const freshT2 =
    isFreshPostSecureM5Bar({
      barTime: m5Time,
      securedAfterM5BarTime: doc.t2SecuredAfterM5BarTime,
      alreadyConfirmedBarTime: doc.t2ContinuationBarTime
    }) &&
    m5CloseConfirmsContinuation({
      side: doc.side,
      completedClose: m5Close,
      level: doc.tp2
    });

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
    brokerRemainingLots: brokerRemaining,
    targetTouchPrice: touch,
    brokerPositionOpen: true,
    m5ContinuationBeyondTp1: freshT1,
    m5ContinuationBeyondTp2: freshT2,
    completedM5BarTime: m5Time,
    volumeRules: {
      minLots: symbol.minVolume,
      maxLots: symbol.maxVolume,
      stepLots: symbol.volumeStep
    },
    stopBuffer: {
      normalizedMinStopPriceDistance: symbol.normalizedMinStopPriceDistance,
      rawSlDistance: symbol.rawSlDistance,
      distanceSetIn: symbol.distanceSetIn,
      digits: symbol.digits,
      referencePrice: doc.tp1 ?? doc.entry,
      spread: quote?.spread ?? null,
      tickSize: symbol.tickSize
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
    const extras: Partial<DemoPositionLifecycle> = {
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
    };
    if (action.nextStage === "T1_SECURED_BE") {
      extras.t1SecuredAt = stamp();
      extras.t1SecuredAfterM5BarTime = m5Time;
      extras.currentRisk = 0;
    }
    if (action.nextStage === "T2_SECURED") {
      extras.t2SecuredAt = stamp();
      extras.t2SecuredAfterM5BarTime = m5Time;
    }
    const ev = appendLifecycleEvent(doc, {
      at: stamp(),
      kind: "RECOMMENDATION",
      reason: `PROFIT_LOCK advance → ${action.nextStage}: ${action.reason}`,
      dedupeKey: `profit_lock:advance:${action.nextStage}:${action.reason}:${action.t1ContinuationBarTime ?? action.t2ContinuationBarTime ?? "na"}`
    });
    doc = withStage(ev.applied ? ev.doc : doc, action.nextStage, extras);
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
      pendingClose: null,
      pendingAmend: null,
      profitLockLastBlocker: null
    });
    await deps.save(doc);
    return { doc, mutations, action, blockedReason: null };
  }

  if (action.type === "PARTIAL_CLOSE") {
    return executePartialClose(doc, deps, mutations, stamp, action, m5Time);
  }

  if (action.type === "AMEND_SL") {
    return executeAmendSl(doc, deps, mutations, stamp, action, m5Time);
  }

  return { doc, mutations, action: null, blockedReason: "UNHANDLED_ACTION" };
}

async function executePartialClose(
  docIn: DemoPositionLifecycle,
  deps: ProfitLockDeps,
  mutations: ProfitLockMutationCounters,
  stamp: () => string,
  action: Extract<ProfitLockAction, { type: "PARTIAL_CLOSE" }>,
  _m5Time: number | null
): Promise<{
  doc: DemoPositionLifecycle;
  mutations: ProfitLockMutationCounters;
  action: ProfitLockAction | null;
  blockedReason: string | null;
}> {
  let doc = docIn;
  const positionId = doc.brokerPositionId;
  if (!positionId) {
    doc = { ...doc, profitLockLastBlocker: "NO_BROKER_POSITION_ID", updatedAt: stamp() };
    await deps.save(doc);
    return { doc, mutations, action, blockedReason: "NO_BROKER_POSITION_ID" };
  }

  // Persist intent BEFORE broker mutation.
  const intent: PendingCloseIntent = {
    tag: action.tag,
    desiredCumulativeLots: action.desiredCumulativeLots,
    requestedLots: action.lots,
    volumeUnits: action.volumeUnits,
    submittedAt: stamp(),
    brokerAccepted: null
  };
  doc = withStage(doc, action.submittingStage, {
    pendingClose: intent,
    intendedT1CloseLots:
      action.tag === "T1" ? action.lots : doc.intendedT1CloseLots,
    intendedT2CloseLots:
      action.tag === "T2" ? action.lots : doc.intendedT2CloseLots,
    profitLockLastBlocker: null
  });
  await deps.save(doc);

  // Re-check broker before sending.
  const pre = await reconcileMatch(deps, doc.uid, positionId);
  if (pre === "RECONCILE_FAILED") {
    doc = withStage(doc, action.pendingStage, {
      pendingClose: { ...intent, brokerAccepted: null },
      profitLockLastBlocker: "RECONCILE_FAILED_BEFORE_CLOSE"
    });
    await deps.save(doc);
    return { doc, mutations, action, blockedReason: "RECONCILE_FAILED" };
  }
  if (!pre) {
    doc = withStage(doc, "CLOSE_RECONCILIATION_PENDING", {
      status: "CLOSE_RECONCILIATION_PENDING",
      pendingClose: null
    });
    await deps.save(doc);
    return { doc, mutations, action, blockedReason: "BROKER_ALREADY_FLAT" };
  }
  const originalLots = doc.lots ?? 0;
  if (
    action.tag !== "T3_REMAINDER" &&
    cumulativeSatisfied(originalLots, pre.volumeLots ?? 0, action.desiredCumulativeLots)
  ) {
    doc = withStage(doc, action.doneStage, {
      pendingClose: null,
      remainingLots: pre.volumeLots,
      cumulativeClosedLots: brokerClosedLots(originalLots, pre.volumeLots ?? 0),
      tp1Status: action.tag === "T1" ? "PARTIAL_CLOSED" : doc.tp1Status,
      tp2Status: action.tag === "T2" ? "PARTIAL_CLOSED" : doc.tp2Status
    });
    await deps.save(doc);
    return { doc, mutations, action, blockedReason: null };
  }

  try {
    const result = await deps.closePosition({
      ownerUid: doc.uid,
      positionId,
      volumeUnits: action.volumeUnits
    });
    mutations.partialCloses += 1;
    if (action.tag === "T3_REMAINDER") mutations.positionCloses += 1;
    doc = withStage(doc, action.pendingStage, {
      pendingClose: { ...intent, brokerAccepted: result.accepted },
      profitLockLastBlocker: result.accepted
        ? "CLOSE_PENDING_BROKER_PROOF"
        : "CLOSE_NOT_ACCEPTED_PENDING_PROOF"
    });
    await deps.save(doc);
  } catch (err) {
    doc = withStage(doc, action.pendingStage, {
      pendingClose: { ...intent, brokerAccepted: false },
      profitLockLastBlocker: `PARTIAL_CLOSE_ERROR:${
        err instanceof Error ? err.message : "unknown"
      }`
    });
    await deps.save(doc);
    return { doc, mutations, action, blockedReason: "PARTIAL_CLOSE_ERROR" };
  }

  // Immediate reconcile attempt — advance only on broker proof.
  return reconcilePendingClose(doc, deps, mutations, stamp, null);
}

async function reconcilePendingClose(
  docIn: DemoPositionLifecycle,
  deps: ProfitLockDeps,
  mutations: ProfitLockMutationCounters,
  stamp: () => string,
  knownMatch: BrokerOpenPosition | null | "RECONCILE_FAILED"
): Promise<{
  doc: DemoPositionLifecycle;
  mutations: ProfitLockMutationCounters;
  action: ProfitLockAction | null;
  blockedReason: string | null;
}> {
  let doc = docIn;
  const intent = doc.pendingClose;
  const stage = doc.profitLockStage;
  const originalLots = doc.lots ?? 0;

  const doneStage: ProfitLockStage =
    stage === "T1_CLOSE_SUBMITTING" || stage === "T1_CLOSE_PENDING_RECONCILE"
      ? "T1_PARTIAL_DONE_SL_PENDING"
      : stage === "T2_CLOSE_SUBMITTING" || stage === "T2_CLOSE_PENDING_RECONCILE"
        ? "T2_PARTIAL_DONE"
        : "CLOSE_RECONCILIATION_PENDING";

  const pendingStage: ProfitLockStage =
    stage === "T1_CLOSE_SUBMITTING"
      ? "T1_CLOSE_PENDING_RECONCILE"
      : stage === "T2_CLOSE_SUBMITTING"
        ? "T2_CLOSE_PENDING_RECONCILE"
        : stage === "T3_CLOSE_SUBMITTING"
          ? "T3_CLOSE_PENDING_RECONCILE"
          : (stage as ProfitLockStage);

  // SUBMITTING without completed call: if volume unchanged, allow one send.
  if (
    (stage === "T1_CLOSE_SUBMITTING" ||
      stage === "T2_CLOSE_SUBMITTING" ||
      stage === "T3_CLOSE_SUBMITTING") &&
    intent &&
    intent.brokerAccepted == null
  ) {
    const pre = knownMatch === "RECONCILE_FAILED"
      ? "RECONCILE_FAILED"
      : knownMatch !== null && knownMatch !== undefined
        ? knownMatch
        : await reconcileMatch(deps, doc.uid, doc.brokerPositionId);
    if (pre === "RECONCILE_FAILED") {
      doc = {
        ...doc,
        profitLockLastBlocker: "RECONCILE_FAILED",
        updatedAt: stamp()
      };
      await deps.save(doc);
      return { doc, mutations, action: null, blockedReason: "RECONCILE_FAILED" };
    }
    if (
      pre &&
      intent.tag !== "T3_REMAINDER" &&
      cumulativeSatisfied(
        originalLots,
        pre.volumeLots ?? 0,
        intent.desiredCumulativeLots
      )
    ) {
      doc = withStage(doc, doneStage, {
        pendingClose: null,
        remainingLots: pre.volumeLots,
        cumulativeClosedLots: brokerClosedLots(originalLots, pre.volumeLots ?? 0),
        tp1Status: intent.tag === "T1" ? "PARTIAL_CLOSED" : doc.tp1Status,
        tp2Status: intent.tag === "T2" ? "PARTIAL_CLOSED" : doc.tp2Status
      });
      await deps.save(doc);
      return { doc, mutations, action: null, blockedReason: null };
    }
    if (!doc.brokerPositionId) {
      return { doc, mutations, action: null, blockedReason: "NO_BROKER_POSITION_ID" };
    }
    try {
      const result = await deps.closePosition({
        ownerUid: doc.uid,
        positionId: doc.brokerPositionId,
        volumeUnits: intent.volumeUnits
      });
      mutations.partialCloses += 1;
      doc = withStage(doc, pendingStage, {
        pendingClose: { ...intent, brokerAccepted: result.accepted }
      });
      await deps.save(doc);
    } catch {
      doc = withStage(doc, pendingStage, {
        pendingClose: { ...intent, brokerAccepted: false },
        profitLockLastBlocker: "CLOSE_SEND_FAILED_PENDING_PROOF"
      });
      await deps.save(doc);
      return { doc, mutations, action: null, blockedReason: "CLOSE_SEND_FAILED" };
    }
  }

  const match = await reconcileMatch(deps, doc.uid, doc.brokerPositionId);
  if (match === "RECONCILE_FAILED") {
    doc = withStage(doc, pendingStage, {
      profitLockLastBlocker: "RECONCILE_FAILED"
    });
    await deps.save(doc);
    return { doc, mutations, action: null, blockedReason: "RECONCILE_FAILED" };
  }

  if (!match) {
    // Flat — for T3 this is success; for T1/T2 unexpected full close → reconcile path.
    const ev = appendLifecycleEvent(doc, {
      at: stamp(),
      kind: "CLOSE_PENDING",
      reason: "PROFIT_LOCK: broker flat during pending close reconcile",
      dedupeKey: `profit_lock:pending_flat:${doc.correlationId}:${stage}`
    });
    doc = withStage(ev.applied ? ev.doc : doc, "CLOSE_RECONCILIATION_PENDING", {
      status: "CLOSE_RECONCILIATION_PENDING",
      pendingClose: null
    });
    await deps.save(doc);
    return { doc, mutations, action: null, blockedReason: null };
  }

  const rem = match.volumeLots ?? 0;
  const desired = intent?.desiredCumulativeLots;
  if (
    desired != null &&
    (intent?.tag === "T3_REMAINDER"
      ? rem <= 1e-8
      : cumulativeSatisfied(originalLots, rem, desired))
  ) {
    const ev = appendLifecycleEvent(doc, {
      at: stamp(),
      kind: "PARTIAL_CLOSE",
      reason: `PROFIT_LOCK ${intent?.tag ?? "CLOSE"} broker-confirmed (remaining=${rem})`,
      brokerAck: true,
      dedupeKey: `profit_lock:confirmed:${intent?.tag}:${desired}:${rem}`
    });
    doc = withStage(ev.doc, doneStage, {
      pendingClose: null,
      remainingLots: rem,
      cumulativeClosedLots: brokerClosedLots(originalLots, rem),
      tp1Status: intent?.tag === "T1" ? "PARTIAL_CLOSED" : doc.tp1Status,
      tp2Status: intent?.tag === "T2" ? "PARTIAL_CLOSED" : doc.tp2Status,
      tp3Status: intent?.tag === "T3_REMAINDER" ? "HIT" : doc.tp3Status,
      status:
        doneStage === "CLOSE_RECONCILIATION_PENDING"
          ? "CLOSE_RECONCILIATION_PENDING"
          : doc.status,
      profitLockLastBlocker: null
    });
    await deps.save(doc);
    return { doc, mutations, action: null, blockedReason: null };
  }

  // Volume unchanged — remain pending; do NOT resend.
  doc = withStage(doc, pendingStage, {
    remainingLots: rem,
    cumulativeClosedLots: brokerClosedLots(originalLots, rem),
    currentSl: match.stopLoss ?? doc.currentSl,
    profitLockLastBlocker: "CLOSE_PENDING_VOLUME_UNCHANGED"
  });
  await deps.save(doc);
  return {
    doc,
    mutations,
    action: null,
    blockedReason: "CLOSE_PENDING_VOLUME_UNCHANGED"
  };
}

async function executeAmendSl(
  docIn: DemoPositionLifecycle,
  deps: ProfitLockDeps,
  mutations: ProfitLockMutationCounters,
  stamp: () => string,
  action: Extract<ProfitLockAction, { type: "AMEND_SL" }>,
  m5Time: number | null
): Promise<{
  doc: DemoPositionLifecycle;
  mutations: ProfitLockMutationCounters;
  action: ProfitLockAction | null;
  blockedReason: string | null;
}> {
  let doc = docIn;
  const positionId = doc.brokerPositionId;
  if (!positionId) {
    doc = { ...doc, profitLockLastBlocker: "NO_BROKER_POSITION_ID", updatedAt: stamp() };
    await deps.save(doc);
    return { doc, mutations, action, blockedReason: "NO_BROKER_POSITION_ID" };
  }

  const intent: PendingAmendIntent = {
    kind: action.amendKind,
    stopLoss: action.stopLoss,
    takeProfit: action.takeProfit ?? null,
    nextStage: action.nextStage,
    nextProtection: action.nextProtection,
    submittedAt: stamp(),
    brokerAccepted: null
  };
  doc = withStage(doc, action.pendingStage, {
    pendingAmend: intent,
    profitLockLastBlocker: null
  });
  await deps.save(doc);

  try {
    const result = await deps.amendStopLoss({
      ownerUid: doc.uid,
      positionId,
      stopLoss: action.stopLoss,
      takeProfit: action.takeProfit ?? null
    });
    mutations.slAmends += 1;
    if (action.takeProfit != null) mutations.tpAmends += 1;
    doc = withStage(doc, action.pendingStage, {
      pendingAmend: { ...intent, brokerAccepted: result.accepted },
      profitLockLastBlocker: result.accepted
        ? "SL_AMEND_PENDING_BROKER_PROOF"
        : "SL_AMEND_NOT_ACCEPTED_PENDING_PROOF"
    });
    await deps.save(doc);
  } catch (err) {
    doc = withStage(doc, action.pendingStage, {
      pendingAmend: { ...intent, brokerAccepted: false },
      profitLockLastBlocker: `SL_AMEND_ERROR:${
        err instanceof Error ? err.message : "unknown"
      }`
    });
    await deps.save(doc);
    return { doc, mutations, action, blockedReason: "SL_AMEND_ERROR" };
  }

  return reconcilePendingAmend(doc, deps, mutations, stamp, null, m5Time);
}

async function reconcilePendingAmend(
  docIn: DemoPositionLifecycle,
  deps: ProfitLockDeps,
  mutations: ProfitLockMutationCounters,
  stamp: () => string,
  knownMatch: BrokerOpenPosition | null | "RECONCILE_FAILED",
  m5Time?: number | null
): Promise<{
  doc: DemoPositionLifecycle;
  mutations: ProfitLockMutationCounters;
  action: ProfitLockAction | null;
  blockedReason: string | null;
}> {
  let doc = docIn;
  const intent = doc.pendingAmend;
  if (!intent) {
    doc = { ...doc, profitLockLastBlocker: "PENDING_AMEND_MISSING", updatedAt: stamp() };
    await deps.save(doc);
    return { doc, mutations, action: null, blockedReason: "PENDING_AMEND_MISSING" };
  }

  const match =
    knownMatch === "RECONCILE_FAILED"
      ? "RECONCILE_FAILED"
      : knownMatch != null
        ? knownMatch
        : await reconcileMatch(deps, doc.uid, doc.brokerPositionId);

  if (match === "RECONCILE_FAILED") {
    doc = {
      ...doc,
      profitLockLastBlocker: "RECONCILE_FAILED",
      updatedAt: stamp()
    };
    await deps.save(doc);
    return { doc, mutations, action: null, blockedReason: "RECONCILE_FAILED" };
  }
  if (!match) {
    doc = withStage(doc, "CLOSE_RECONCILIATION_PENDING", {
      status: "CLOSE_RECONCILIATION_PENDING",
      pendingAmend: null
    });
    await deps.save(doc);
    return { doc, mutations, action: null, blockedReason: "BROKER_FLAT_DURING_AMEND" };
  }

  const expectedTp3 = doc.brokerHardTakeProfit ?? doc.tp3;
  if (!brokerTp3Preserved({ brokerTp: match.takeProfit, expectedTp3 })) {
    const ev = appendLifecycleEvent(doc, {
      at: stamp(),
      kind: "PROTECTION_FAILURE",
      reason: `PROFIT_LOCK: broker TP3 lost/changed (expected ${expectedTp3}, got ${match.takeProfit})`,
      dedupeKey: `profit_lock:tp3_lost:${doc.correlationId}:${intent.kind}`
    });
    doc = {
      ...ev.doc,
      pendingAmend: intent,
      protectionFailure: true,
      profitLockLastBlocker: "BROKER_TP3_NOT_PRESERVED",
      updatedAt: stamp()
    };
    await deps.save(doc);
    return {
      doc,
      mutations,
      action: null,
      blockedReason: "BROKER_TP3_NOT_PRESERVED"
    };
  }

  if (
    !brokerSlConfirmsRequested({
      side: doc.side,
      brokerSl: match.stopLoss,
      requestedSl: intent.stopLoss
    })
  ) {
    doc = {
      ...doc,
      currentSl: match.stopLoss ?? doc.currentSl,
      profitLockLastBlocker: "SL_AMEND_PENDING_OLD_SL",
      updatedAt: stamp()
    };
    await deps.save(doc);
    return {
      doc,
      mutations,
      action: null,
      blockedReason: "SL_AMEND_PENDING_OLD_SL"
    };
  }

  // Broker-confirmed SL + TP3.
  const bars = m5Time != null ? null : await deps.getCompletedM5Bars(doc.uid).catch(() => []);
  const latestM5 =
    m5Time ??
    (bars && bars.length > 0 ? bars[bars.length - 1]!.time : null);

  const ev = appendLifecycleEvent(doc, {
    at: stamp(),
    kind: intent.nextProtection === "BE" ? "BREAKEVEN" : "SL_AMENDED",
    reason: `PROFIT_LOCK broker-confirmed ${intent.kind} SL=${match.stopLoss} TP3=${match.takeProfit}`,
    oldSl: doc.currentSl,
    newSl: match.stopLoss,
    brokerAck: true,
    dedupeKey: `profit_lock:sl_confirmed:${intent.kind}:${intent.stopLoss}`
  });

  const extras: Partial<DemoPositionLifecycle> = {
    pendingAmend: null,
    currentSl: match.stopLoss,
    profitLockProtectionLevel: maxProtectionLevel(
      doc.profitLockProtectionLevel ?? "NONE",
      intent.nextProtection
    ),
    lockedProfitDistance: lockedProfitDistance(
      doc.side,
      doc.entry,
      match.stopLoss
    ),
    currentRisk:
      intent.nextProtection === "BE" ? 0 : doc.currentRisk,
    profitLockLastBlocker: null,
    lastRecommendation: `PROFIT_LOCK:${intent.kind}_CONFIRMED`
  };
  if (intent.nextStage === "T1_SECURED_BE") {
    extras.t1SecuredAt = stamp();
    extras.t1SecuredAfterM5BarTime = latestM5;
    extras.currentRisk = 0;
  }
  if (intent.nextStage === "T2_SECURED") {
    extras.t2SecuredAt = stamp();
    extras.t2SecuredAfterM5BarTime = latestM5;
  }

  doc = withStage(ev.doc, intent.nextStage, extras);
  await deps.save(doc);
  return { doc, mutations, action: null, blockedReason: null };
}
