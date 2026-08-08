/**
 * Demo position lifecycle — persist, reconcile, protect, manage.
 * Uses approved decisionEngine management actions only.
 * Live execution remains hard-locked.
 */

import { evaluateManagement } from "../../decisionEngine/management";
import type { OpenPositionInput } from "../../decisionEngine/types";
import { getUserAutoTradeSettings } from "./userAutoTradeSettings";
import {
  getPositionLifecycle,
  listOpenPositionLifecycles,
  listOpenPositionOwners,
  savePositionLifecycle
} from "./positionLifecycleStore";
import type { DemoPositionLifecycle } from "./positionLifecycleTypes";
import {
  appendLifecycleEvent,
  emptyTpStatuses
} from "./positionLifecycleTypes";
import {
  amendDemoStopLoss,
  closeDemoBrokerPosition,
  reconcileDemoBrokerPositions
} from "./demoPositionMutations";
import { updateAutoTradeJournalOnClose } from "./autoTradeJournal";
import { notifyAutoTradeEvent } from "./autoTradeNotifications";
import { getExecutableQuoteForAutoTrade } from "./quoteService";
import { evaluateNewsGuard } from "./newsGuard";
import { setEmergencyStop } from "./userAutoTradeSettings";

function riskDistance(entry: number | null, sl: number | null): number | null {
  if (entry == null || sl == null) return null;
  const d = Math.abs(entry - sl);
  return Number.isFinite(d) ? d : null;
}

function defaultTpLadder(args: {
  side: "BUY" | "SELL";
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
}): { tp1: number | null; tp2: number | null; tp3: number | null } {
  const risk = riskDistance(args.entry, args.stopLoss);
  if (args.entry == null || risk == null || risk <= 0) {
    return { tp1: args.takeProfit, tp2: null, tp3: null };
  }
  const sign = args.side === "BUY" ? 1 : -1;
  const tp1 = args.takeProfit ?? Number((args.entry + sign * risk * 1).toFixed(2));
  const tp2 = Number((args.entry + sign * risk * 1.5).toFixed(2));
  const tp3 = Number((args.entry + sign * risk * 2).toFixed(2));
  return { tp1, tp2, tp3 };
}

export async function createDemoPositionLifecycle(args: {
  uid: string;
  correlationId: string;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  accountId: string | null;
  accountMasked: string | null;
  side: "BUY" | "SELL";
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lots: number | null;
  qualificationStage: string | null;
  decisionId: string | null;
  source: "qualification_controlled" | "demo_auto" | "manual";
  openedAt: string;
}): Promise<DemoPositionLifecycle> {
  const existing = await getPositionLifecycle(args.uid, args.correlationId);
  if (existing) return existing;

  const tps = defaultTpLadder({
    side: args.side,
    entry: args.entry,
    stopLoss: args.stopLoss,
    takeProfit: args.takeProfit
  });
  const initialRisk = riskDistance(args.entry, args.stopLoss);
  const doc: DemoPositionLifecycle = {
    id: args.correlationId,
    uid: args.uid,
    environment: "DEMO",
    correlationId: args.correlationId,
    brokerOrderId: args.brokerOrderId,
    brokerPositionId: args.brokerPositionId,
    accountId: args.accountId,
    accountMasked: args.accountMasked,
    symbol: "XAUUSD",
    side: args.side,
    entry: args.entry,
    currentPrice: args.entry,
    lots: args.lots,
    remainingLots: args.lots,
    initialSl: args.stopLoss,
    currentSl: args.stopLoss,
    tp1: tps.tp1,
    tp2: tps.tp2,
    tp3: tps.tp3,
    ...emptyTpStatuses(),
    openedAt: args.openedAt,
    closedAt: null,
    realisedPnl: null,
    unrealisedPnl: null,
    initialRisk,
    currentRisk: initialRisk,
    qualificationStage: args.qualificationStage,
    decisionId: args.decisionId,
    setupRef: args.decisionId,
    source: args.source,
    managementState: args.stopLoss != null ? "SL_PROTECTED" : "HOLD",
    lastRecommendation: null,
    protectionVerified: false,
    protectionFailure: false,
    events: [],
    appliedDedupeKeys: [],
    updatedAt: new Date().toISOString(),
    status: "OPEN"
  };
  const opened = appendLifecycleEvent(doc, {
    at: args.openedAt,
    kind: "OPENED",
    reason: "Demo position opened",
    dedupeKey: `open:${args.correlationId}`
  });
  await savePositionLifecycle(opened.doc);
  return opened.doc;
}

function tpHit(
  side: "BUY" | "SELL",
  price: number | null,
  level: number | null
): boolean {
  if (price == null || level == null) return false;
  return side === "BUY" ? price >= level : price <= level;
}

function buildManagementInput(
  doc: DemoPositionLifecycle,
  currentPrice: number,
  highImpactNewsActive: boolean
): OpenPositionInput {
  return {
    side: doc.side,
    entryPrice: doc.entry ?? currentPrice,
    stopLoss: doc.currentSl ?? doc.initialSl ?? currentPrice,
    currentPrice,
    takeProfits: { tp1: doc.tp1, tp2: doc.tp2, tp3: doc.tp3 },
    tp1Hit: doc.tp1Status === "HIT" || doc.tp1Status === "PARTIAL_CLOSED",
    spread: null,
    isStale: false,
    highImpactNewsActive,
    relativeVolume: null,
    poc: null,
    vwap: null,
    confirmationCandle: { confirmed: false, state: "NONE" },
    trendMeter: { state: "NEUTRAL", strength: 0 }
  };
}

async function verifyAndRepairProtection(
  doc: DemoPositionLifecycle
): Promise<DemoPositionLifecycle> {
  if (!doc.brokerPositionId || doc.initialSl == null) {
    const failed = appendLifecycleEvent(doc, {
      at: new Date().toISOString(),
      kind: "PROTECTION_FAILURE",
      reason: "Missing broker position id or initial SL",
      dedupeKey: `prot_fail_missing:${doc.correlationId}`
    });
    if (!failed.applied) return doc;
    const next = {
      ...failed.doc,
      protectionVerified: false,
      protectionFailure: true,
      managementState: "PROTECTION_FAILURE" as const,
      status: "FAILED_PROTECTION" as const
    };
    await savePositionLifecycle(next);
    try {
      await setEmergencyStop(doc.uid, "demo", true);
      await notifyAutoTradeEvent({
        uid: doc.uid,
        kind: "EMERGENCY_STOP",
        title: "Execution safety failure",
        body: "Automated Demo entry could not confirm Stop Loss protection. New entries paused.",
        dedupeKey: `prot_fail_${doc.correlationId}`
      });
    } catch {
      /* ignore */
    }
    return next;
  }

  let brokerPositions;
  try {
    brokerPositions = await reconcileDemoBrokerPositions(doc.uid);
  } catch {
    return doc;
  }
  const match = brokerPositions.find((p) => p.positionId === doc.brokerPositionId);
  if (!match) {
    // Position already closed at broker — reconcile close path handles it.
    return doc;
  }

  let next = {
    ...doc,
    currentPrice: match.entryPrice ?? doc.currentPrice,
    currentSl: match.stopLoss ?? doc.currentSl,
    remainingLots: match.volumeLots ?? doc.remainingLots,
    unrealisedPnl: match.unrealisedPnl
  };

  if (match.stopLoss != null && Number.isFinite(match.stopLoss)) {
    const verified = appendLifecycleEvent(next, {
      at: new Date().toISOString(),
      kind: "SL_VERIFIED",
      reason: "Broker Stop Loss confirmed",
      newSl: match.stopLoss,
      brokerAck: true,
      dedupeKey: `sl_verified:${doc.correlationId}:${match.stopLoss}`
    });
    next = {
      ...verified.doc,
      protectionVerified: true,
      protectionFailure: false,
      managementState:
        verified.doc.managementState === "HOLD" ||
        verified.doc.managementState === "SL_PROTECTED"
          ? "SL_PROTECTED"
          : verified.doc.managementState
    };
    await savePositionLifecycle(next);
    return next;
  }

  // Attempt to apply required SL once
  const amendKey = `sl_repair:${doc.correlationId}:${doc.initialSl}`;
  if (doc.appliedDedupeKeys.includes(amendKey)) {
    return next;
  }
  try {
    const result = await amendDemoStopLoss({
      ownerUid: doc.uid,
      positionId: doc.brokerPositionId,
      stopLoss: doc.initialSl,
      takeProfit: doc.tp1
    });
    if (result.accepted) {
      const amended = appendLifecycleEvent(next, {
        at: new Date().toISOString(),
        kind: "SL_AMENDED",
        reason: "Applied required Stop Loss after broker ack",
        oldSl: null,
        newSl: doc.initialSl,
        brokerAck: true,
        dedupeKey: amendKey
      });
      next = {
        ...amended.doc,
        currentSl: doc.initialSl,
        protectionVerified: true,
        managementState: "SL_PROTECTED"
      };
      await savePositionLifecycle(next);
      return next;
    }
  } catch {
    /* fall through to failure */
  }

  const failed = appendLifecycleEvent(next, {
    at: new Date().toISOString(),
    kind: "PROTECTION_FAILURE",
    reason: "Stop Loss could not be confirmed on broker Demo position",
    dedupeKey: `prot_fail:${doc.correlationId}`
  });
  next = {
    ...failed.doc,
    protectionVerified: false,
    protectionFailure: true,
    managementState: "PROTECTION_FAILURE",
    status: "FAILED_PROTECTION"
  };
  await savePositionLifecycle(next);
  try {
    await setEmergencyStop(doc.uid, "demo", true);
    await notifyAutoTradeEvent({
      uid: doc.uid,
      kind: "EMERGENCY_STOP",
      title: "Execution safety failure",
      body: "Automated Demo trade left unprotected — Emergency Stop engaged for Demo.",
      dedupeKey: `prot_fail_notify_${doc.correlationId}`
    });
  } catch {
    /* ignore */
  }
  return next;
}

async function closeLifecycle(args: {
  doc: DemoPositionLifecycle;
  pnl: number | null;
  reason: string;
  dedupeKey: string;
}): Promise<DemoPositionLifecycle> {
  const { doc, pnl, reason, dedupeKey } = args;
  if (doc.status === "CLOSED") return doc;
  const closedAt = new Date().toISOString();
  const appended = appendLifecycleEvent(doc, {
    at: closedAt,
    kind: "CLOSE",
    reason,
    brokerAck: true,
    dedupeKey
  });
  if (!appended.applied) return doc;
  const next: DemoPositionLifecycle = {
    ...appended.doc,
    status: "CLOSED",
    closedAt,
    realisedPnl: pnl,
    managementState: "CLOSED",
    currentRisk: 0
  };
  await savePositionLifecycle(next);
  try {
    // Dynamic import avoids circular dependency with qualificationService.
    const { markQualificationTradeClosed } = await import(
      "./qualificationService.js"
    );
    await markQualificationTradeClosed({
      uid: doc.uid,
      correlationId: doc.correlationId,
      pnl
    });
  } catch {
    /* qualification close best-effort */
  }
  try {
    const openedMs = Date.parse(doc.openedAt);
    const durationSeconds = Number.isFinite(openedMs)
      ? Math.max(0, Math.round((Date.now() - openedMs) / 1000))
      : null;
    await updateAutoTradeJournalOnClose({
      uid: doc.uid,
      correlationId: doc.correlationId,
      pnl,
      closedAt,
      reasonForExit: reason,
      exitPrice: doc.currentPrice,
      managementActions: next.events.map((e) => e.kind),
      durationSeconds,
      slTpOutcome: [
        `TP1 ${next.tp1Status}`,
        `TP2 ${next.tp2Status}`,
        `TP3 ${next.tp3Status}`,
        next.managementState
      ].join(" · ")
    });
  } catch {
    /* journal best-effort */
  }
  return next;
}

export async function manageOpenDemoPosition(
  uid: string,
  correlationId: string
): Promise<DemoPositionLifecycle | null> {
  let doc = await getPositionLifecycle(uid, correlationId);
  if (!doc || doc.status === "CLOSED") return doc;

  // First: protection verification
  if (!doc.protectionVerified && !doc.protectionFailure) {
    doc = await verifyAndRepairProtection(doc);
    if (doc.protectionFailure || doc.status !== "OPEN") return doc;
  }

  let brokerPositions: Awaited<ReturnType<typeof reconcileDemoBrokerPositions>> =
    [];
  try {
    brokerPositions = await reconcileDemoBrokerPositions(uid);
  } catch {
    return doc;
  }

  const match = doc.brokerPositionId
    ? brokerPositions.find((p) => p.positionId === doc!.brokerPositionId)
    : null;

  if (!match) {
    // Broker no longer has the position — treat as closed once.
    return closeLifecycle({
      doc,
      pnl: doc.realisedPnl ?? doc.unrealisedPnl ?? 0,
      reason: "Broker position closed (reconcile)",
      dedupeKey: `close_reconcile:${doc.correlationId}`
    });
  }

  const quote = await getExecutableQuoteForAutoTrade({ ownerUid: uid }).catch(
    () => null
  );
  const mid =
    quote && quote.bid != null && quote.ask != null
      ? (quote.bid + quote.ask) / 2
      : match.entryPrice;
  const currentPrice = mid ?? match.entryPrice ?? doc.currentPrice;
  doc = {
    ...doc,
    currentPrice,
    currentSl: match.stopLoss ?? doc.currentSl,
    remainingLots: match.volumeLots ?? doc.remainingLots,
    unrealisedPnl: match.unrealisedPnl,
    currentRisk: riskDistance(doc.entry, match.stopLoss ?? doc.currentSl)
  };

  // TP lifecycle tracking (recommendation / hit flags — no invented exits)
  if (tpHit(doc.side, currentPrice, doc.tp1) && doc.tp1Status === "PENDING") {
    const hit = appendLifecycleEvent(doc, {
      at: new Date().toISOString(),
      kind: "TP1",
      reason: "Price reached TP1",
      dedupeKey: `tp1:${doc.correlationId}`
    });
    if (hit.applied) {
      doc = {
        ...hit.doc,
        tp1Status: "HIT",
        managementState: "TP1_HIT"
      };
    }
  }
  if (tpHit(doc.side, currentPrice, doc.tp2) && doc.tp2Status === "PENDING") {
    const hit = appendLifecycleEvent(doc, {
      at: new Date().toISOString(),
      kind: "TP2",
      reason: "Price reached TP2",
      dedupeKey: `tp2:${doc.correlationId}`
    });
    if (hit.applied) {
      doc = { ...hit.doc, tp2Status: "HIT", managementState: "TP2_HIT" };
    }
  }
  if (tpHit(doc.side, currentPrice, doc.tp3) && doc.tp3Status === "PENDING") {
    const hit = appendLifecycleEvent(doc, {
      at: new Date().toISOString(),
      kind: "TP3",
      reason: "Price reached TP3",
      dedupeKey: `tp3:${doc.correlationId}`
    });
    if (hit.applied) {
      doc = { ...hit.doc, tp3Status: "HIT", managementState: "TP3_HIT" };
    }
  }

  const settings = await getUserAutoTradeSettings(uid, "demo");
  const news = evaluateNewsGuard({
    mode: settings.newsFilterEnabled ? settings.newsImpactMode : "OFF",
    minutesBefore: settings.newsMinutesBefore,
    minutesAfter: settings.newsMinutesAfter
  });

  const mgmt = evaluateManagement(
    buildManagementInput(doc, currentPrice ?? doc.entry ?? 0, news.active)
  );
  doc = {
    ...doc,
    lastRecommendation: `${mgmt.action}: ${mgmt.explanation}`
  };

  if (mgmt.action === "MOVE_SL_TO_BREAKEVEN") {
    doc = {
      ...doc,
      managementState:
        doc.managementState === "BREAKEVEN_SET"
          ? "BREAKEVEN_SET"
          : "MOVE_TO_BREAKEVEN"
    };
    if (
      settings.breakEvenEnabled &&
      doc.entry != null &&
      doc.brokerPositionId &&
      doc.managementState !== "BREAKEVEN_SET"
    ) {
      const beKey = `be:${doc.correlationId}:${doc.entry}`;
      if (!doc.appliedDedupeKeys.includes(beKey)) {
        try {
          const oldSl = doc.currentSl;
          const result = await amendDemoStopLoss({
            ownerUid: uid,
            positionId: doc.brokerPositionId,
            stopLoss: doc.entry,
            takeProfit: doc.tp1
          });
          if (result.accepted) {
            const be = appendLifecycleEvent(doc, {
              at: new Date().toISOString(),
              kind: "BREAKEVEN",
              reason: "MOVE_SL_TO_BREAKEVEN — approved management rule",
              oldSl,
              newSl: doc.entry,
              brokerAck: true,
              dedupeKey: beKey
            });
            doc = {
              ...be.doc,
              currentSl: doc.entry,
              managementState: "BREAKEVEN_SET",
              currentRisk: 0
            };
          }
        } catch {
          /* retry next pass */
        }
      }
    }
  } else if (mgmt.action === "TAKE_PARTIAL") {
    // Approved strategy action exists; execute only when user enabled partial TP.
    if (
      settings.partialTakeProfitEnabled &&
      doc.brokerPositionId &&
      doc.tp1Status !== "PARTIAL_CLOSED" &&
      doc.remainingLots != null &&
      doc.remainingLots > 0
    ) {
      const partialLots = Number((doc.remainingLots / 2).toFixed(2));
      const volumeUnits = Math.max(1, Math.round(partialLots * 100));
      const partialKey = `partial_tp1:${doc.correlationId}`;
      if (!doc.appliedDedupeKeys.includes(partialKey)) {
        try {
          const result = await closeDemoBrokerPosition({
            ownerUid: uid,
            positionId: doc.brokerPositionId,
            volumeUnits
          });
          if (result.accepted) {
            const ev = appendLifecycleEvent(doc, {
              at: new Date().toISOString(),
              kind: "PARTIAL_CLOSE",
              reason: "TAKE_PARTIAL — approved management rule (Demo only)",
              brokerAck: true,
              dedupeKey: partialKey
            });
            doc = {
              ...ev.doc,
              tp1Status: "PARTIAL_CLOSED",
              managementState: "TP1_HIT",
              remainingLots: Number(
                ((doc.remainingLots ?? 0) - partialLots).toFixed(2)
              )
            };
          }
        } catch {
          /* retry next pass */
        }
      }
    } else {
      const rec = appendLifecycleEvent(doc, {
        at: new Date().toISOString(),
        kind: "RECOMMENDATION",
        reason: "TAKE_PARTIAL recommended (tracking only — partial exit not enabled)",
        dedupeKey: `rec_partial:${doc.correlationId}`
      });
      if (rec.applied) {
        doc = {
          ...rec.doc,
          managementState: doc.tp1Status === "HIT" ? "TP1_HIT" : doc.managementState
        };
      }
    }
  } else if (mgmt.action === "EXIT_EARLY") {
    // Analysis-only today — do not invent discretionary broker closes.
    const rec = appendLifecycleEvent(doc, {
      at: new Date().toISOString(),
      kind: "RECOMMENDATION",
      reason: "EXIT_EARLY recommended — broker SL/TP left in place (no auto exit)",
      dedupeKey: `rec_exit:${doc.correlationId}`
    });
    if (rec.applied) {
      doc = { ...rec.doc, managementState: "EXIT_SIGNAL" };
    } else {
      doc = { ...doc, managementState: "EXIT_SIGNAL" };
    }
  } else if (
    doc.managementState !== "BREAKEVEN_SET" &&
    doc.managementState !== "TP1_HIT" &&
    doc.managementState !== "TP2_HIT" &&
    doc.managementState !== "TP3_HIT" &&
    doc.managementState !== "PROTECTION_FAILURE"
  ) {
    doc = {
      ...doc,
      managementState: doc.protectionVerified ? "SL_PROTECTED" : "HOLD"
    };
  }

  const recon = appendLifecycleEvent(doc, {
    at: new Date().toISOString(),
    kind: "RECONCILED",
    reason: "Broker reconcile pass",
    dedupeKey: `reconcile:${doc.correlationId}:${new Date().toISOString().slice(0, 16)}`
  });
  // Reconcile events are minute-bucketed; skip persist spam if unchanged aside from that
  doc = recon.applied ? recon.doc : doc;
  await savePositionLifecycle(doc);
  return doc;
}

export async function manageAllOpenDemoPositionsForUser(
  uid: string
): Promise<{ managed: number; closed: number }> {
  const open = await listOpenPositionLifecycles(uid);
  let managed = 0;
  let closed = 0;
  for (const p of open) {
    const next = await manageOpenDemoPosition(uid, p.correlationId);
    managed += 1;
    if (next?.status === "CLOSED") closed += 1;
  }
  return { managed, closed };
}

/**
 * Background worker — Demo position management with PWA closed.
 */
export async function runDemoPositionManagementPass(opts?: {
  limit?: number;
}): Promise<{ owners: number; managed: number; closed: number }> {
  const owners = await listOpenPositionOwners(opts?.limit ?? 40);
  let managed = 0;
  let closed = 0;
  for (const uid of owners) {
    try {
      const r = await manageAllOpenDemoPositionsForUser(uid);
      managed += r.managed;
      closed += r.closed;
    } catch {
      /* continue other owners */
    }
  }
  return { owners: owners.length, managed, closed };
}

export async function getOpenPositionsPublicView(uid: string): Promise<{
  environment: "DEMO";
  positions: Array<Record<string, unknown>>;
}> {
  const open = await listOpenPositionLifecycles(uid);
  return {
    environment: "DEMO",
    positions: open.map((p) => {
      const openedMs = Date.parse(p.openedAt);
      const durationSeconds = Number.isFinite(openedMs)
        ? Math.max(0, Math.round((Date.now() - openedMs) / 1000))
        : null;
      return {
        correlationId: p.correlationId,
        brokerPositionId: p.brokerPositionId,
        accountMasked: p.accountMasked,
        symbol: p.symbol,
        side: p.side,
        entry: p.entry,
        current: p.currentPrice,
        lots: p.remainingLots ?? p.lots,
        stopLoss: p.currentSl,
        initialSl: p.initialSl,
        tp1: p.tp1,
        tp2: p.tp2,
        tp3: p.tp3,
        tp1Status: p.tp1Status,
        tp2Status: p.tp2Status,
        tp3Status: p.tp3Status,
        pnl: p.unrealisedPnl,
        realisedPnl: p.realisedPnl,
        initialRisk: p.initialRisk,
        currentRisk: p.currentRisk,
        openedAt: p.openedAt,
        durationSeconds,
        managementState: p.managementState,
        lastRecommendation: p.lastRecommendation,
        protectionVerified: p.protectionVerified,
        fundsLabel: "DEMO FUNDS",
        qualificationStage: p.qualificationStage
      };
    })
  };
}
