/**
 * AutoTrade qualification orchestration — persistent, per-UID, Demo-only.
 */

import { randomBytes } from "crypto";
import { getConnection } from "./connectionStore";
import { buildDiagnostics } from "./connectionService";
import {
  getUserAutoTradeSettings,
  saveUserAutoTradeSettings
} from "./userAutoTradeSettings";
import { submitDemoMarketOrder } from "./demoOrderExecution";
import { isCTraderLiveEnabled } from "./flags";
import { calculateCTraderVolume } from "./sizing";
import { evaluateQualificationCandidate } from "./qualificationEvaluator";
import type { GoldMetaStore } from "../../storage/types";
import type { DecisionRecord } from "../../../models/types";
import {
  allowsDemoOrderSubmission,
  buildSetupBlockers,
  deriveAdvancedState,
  setupReady,
  toPublicView,
  type SetupSnapshot
} from "./qualificationMachine";
import {
  appendTransition,
  createEmptyQualificationDoc,
  getActiveQualificationAccountId,
  getQualificationDoc,
  recountControlled,
  recountDemoAuto,
  saveQualificationDoc,
  tryAddPreview
} from "./qualificationStore";
import type {
  ControlledDemoTradeRecord,
  QualificationDocument,
  QualificationPreviewRecord,
  QualificationPublicView,
  QualificationState,
  SafetyCheckRecord
} from "./qualificationTypes";
import { QUALIFICATION_GATES } from "./qualificationTypes";

function buildSha(): string | null {
  return (process.env.GOLD_META_COMMIT_SHA || process.env.VITE_GOLD_META_COMMIT_SHA || "").trim() || null;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

export async function loadSetupSnapshot(uid: string): Promise<SetupSnapshot> {
  // Prefer persisted connection + settings for fast qualification UI.
  // Avoid full Open API diagnostics on every GET (can exceed gateway timeouts).
  const [connection, settings] = await Promise.all([
    getConnection(uid),
    getUserAutoTradeSettings(uid, "demo").catch(() => null)
  ]);

  const oauthConnected = Boolean(connection);
  const demoAccountSelected = Boolean(
    connection?.selectedAccountId && !connection.selectedAccountIsLive
  );
  const accountIsLive = Boolean(connection?.selectedAccountIsLive);
  const tradingScope = connection?.oauthScope === "trading";
  const symbolResolved = Boolean(connection?.symbolId || connection?.symbolName);
  const brokerQuoteHealthy = Boolean(connection?.lastQuoteAt);
  const riskConfigured = Boolean(
    settings &&
      settings.fixedRiskAmount > 0 &&
      settings.maxDailyLoss > 0 &&
      settings.maxTradesPerDay > 0 &&
      settings.minConfidence > 0
  );
  const dailyLimitsConfigured = Boolean(
    settings && settings.maxDailyLoss > 0 && settings.maxTradesPerDay > 0
  );
  const emergencyStopActive = Boolean(settings?.emergencyStopActive);

  return {
    authenticated: true,
    approved: true,
    oauthConnected,
    demoAccountSelected,
    accountIsLive,
    accountMasked: connection?.selectedAccountMasked ?? null,
    accountId: connection?.selectedAccountId ?? null,
    symbolResolved,
    tradingScope,
    brokerQuoteHealthy,
    riskConfigured,
    emergencyStopHealthy: true,
    emergencyStopActive,
    dailyLimitsConfigured
  };
}

function certifySafetyChecks(
  existing: SafetyCheckRecord[],
  setup: SetupSnapshot
): SafetyCheckRecord[] {
  const now = new Date().toISOString();
  const mark = (id: SafetyCheckRecord["id"], ok: boolean, detail: string): SafetyCheckRecord => {
    const prev = existing.find((c) => c.id === id);
    return {
      id,
      label: prev?.label ?? id,
      ok,
      source: "SYSTEM_CERTIFIED",
      detail,
      verifiedAt: ok ? prev?.verifiedAt ?? now : null
    };
  };
  return [
    mark(
      "emergency_stop",
      setup.emergencyStopHealthy && !setup.emergencyStopActive,
      "Emergency Stop control present and inactive"
    ),
    mark(
      "daily_loss_lock",
      setup.dailyLimitsConfigured,
      "Daily loss / trade caps loaded from Demo settings"
    ),
    mark(
      "duplicate_order_protection",
      true,
      "Intent/signal idempotency enforced in qualification runner"
    ),
    mark(
      "restart_recovery",
      setup.oauthConnected && setup.demoAccountSelected,
      "Per-user cTrader connection persists across restarts"
    ),
    mark(
      "stale_quote_spread_guards",
      true,
      "Preview engine enforces quote freshness and spread gates"
    ),
    mark(
      "sl_risk_sizing",
      setup.riskConfigured,
      "Stop-loss and risk sizing required by Demo settings / preview"
    )
  ];
}

async function loadOrInitDoc(
  uid: string,
  setup: SetupSnapshot
): Promise<QualificationDocument | null> {
  if (!setup.accountId || setup.accountIsLive) return null;
  const existing = await getQualificationDoc(uid, setup.accountId);
  if (existing) {
    const safetyChecks = certifySafetyChecks(existing.safetyChecks, setup);
    return {
      ...existing,
      accountMasked: setup.accountMasked ?? existing.accountMasked,
      safetyChecks
    };
  }
  const activeId = await getActiveQualificationAccountId(uid);
  if (activeId && activeId !== setup.accountId) {
    const other = await getQualificationDoc(uid, activeId);
    if (other?.startedAt) {
      // Do not silently transfer — caller surfaces account mismatch.
      return other;
    }
  }
  return null;
}

export async function getQualificationView(uid: string): Promise<QualificationPublicView> {
  const setup = await loadSetupSnapshot(uid);
  const blockers = buildSetupBlockers(setup);
  const ready = setupReady(blockers);

  if (setup.accountIsLive) {
    return toPublicView({
      doc: null,
      setup,
      stateOverride: "SETUP_REQUIRED"
    });
  }

  let doc = await loadOrInitDoc(uid, setup);
  if (doc && doc.accountId !== setup.accountId && setup.accountId) {
    // Qualification belongs to another Demo account.
    const view = toPublicView({ doc, setup });
    return {
      ...view,
      state: "SETUP_REQUIRED",
      overallLabel: "Account mismatch",
      nextAction: "Qualification belongs to another Demo account",
      nextRequirement: `Active qualification is for ${doc.accountMasked ?? "another account"}`,
      canStart: false,
      blockers: [
        {
          id: "account_mismatch",
          label: `Qualification belongs to Demo ${doc.accountMasked ?? "account"}`,
          ok: false,
          action: "Switch back to that Demo account or start fresh after support review"
        },
        ...view.blockers
      ]
    };
  }

  if (doc) {
    const advanced = deriveAdvancedState(doc);
    if (advanced !== doc.state && doc.state !== "PAUSED" && doc.state !== "BLOCKED") {
      doc = await appendTransition(doc, advanced, "auto_evaluate", buildSha());
      await saveQualificationDoc(doc);
    } else if (doc) {
      await saveQualificationDoc(doc); // persist certified safety updates
    }
  }

  return toPublicView({
    doc,
    setup,
    stateOverride: !ready && !doc?.startedAt ? "SETUP_REQUIRED" : undefined
  });
}

export async function startQualification(uid: string): Promise<QualificationPublicView> {
  const setup = await loadSetupSnapshot(uid);
  const blockers = buildSetupBlockers(setup);
  if (!setupReady(blockers)) {
    throw Object.assign(new Error("QUALIFICATION_NOT_READY"), {
      code: "QUALIFICATION_NOT_READY",
      blockers
    });
  }
  if (!setup.accountId || setup.accountIsLive) {
    throw Object.assign(new Error("CTRADER_DEMO_ACCOUNT_REQUIRED"), {
      code: "CTRADER_DEMO_ACCOUNT_REQUIRED"
    });
  }
  if (isCTraderLiveEnabled()) {
    throw Object.assign(new Error("LIVE_EXECUTION_FORBIDDEN"), {
      code: "LIVE_EXECUTION_FORBIDDEN"
    });
  }

  let doc = await getQualificationDoc(uid, setup.accountId);
  if (!doc) {
    doc = createEmptyQualificationDoc({
      uid,
      accountId: setup.accountId,
      accountMasked: setup.accountMasked,
      buildSha: buildSha()
    });
  }
  if (doc.startedAt && doc.state !== "READY_TO_QUALIFY" && doc.state !== "SETUP_REQUIRED") {
    return getQualificationView(uid);
  }

  doc.safetyChecks = certifySafetyChecks(doc.safetyChecks, setup);
  doc.startedAt = doc.startedAt ?? new Date().toISOString();
  doc = await appendTransition(doc, "PREVIEW_QUALIFICATION", "user_start_qualification", buildSha());
  await saveQualificationDoc(doc);
  return getQualificationView(uid);
}

export async function pauseQualification(uid: string): Promise<QualificationPublicView> {
  const setup = await loadSetupSnapshot(uid);
  if (!setup.accountId) throw Object.assign(new Error("NO_ACCOUNT"), { code: "NO_ACCOUNT" });
  let doc = await getQualificationDoc(uid, setup.accountId);
  if (!doc) throw Object.assign(new Error("QUALIFICATION_NOT_STARTED"), { code: "QUALIFICATION_NOT_STARTED" });
  if (doc.state === "PAUSED") return getQualificationView(uid);
  doc = {
    ...doc,
    pausedFrom: doc.state
  };
  doc = await appendTransition(doc, "PAUSED", "user_pause", buildSha());
  await saveQualificationDoc(doc);
  return getQualificationView(uid);
}

export async function resumeQualification(uid: string): Promise<QualificationPublicView> {
  const setup = await loadSetupSnapshot(uid);
  if (!setup.accountId) throw Object.assign(new Error("NO_ACCOUNT"), { code: "NO_ACCOUNT" });
  let doc = await getQualificationDoc(uid, setup.accountId);
  if (!doc || doc.state !== "PAUSED") return getQualificationView(uid);
  const resumeTo = deriveAdvancedState({ ...doc, state: doc.pausedFrom ?? "PREVIEW_QUALIFICATION" });
  doc = {
    ...doc,
    pausedFrom: null
  };
  doc = await appendTransition(doc, resumeTo, "user_resume", buildSha());
  await saveQualificationDoc(doc);
  return getQualificationView(uid);
}

export async function enableDemoAutoFromQualification(
  uid: string
): Promise<QualificationPublicView> {
  const setup = await loadSetupSnapshot(uid);
  if (!setup.accountId || setup.accountIsLive || !setup.tradingScope) {
    throw Object.assign(new Error("QUALIFICATION_NOT_READY"), {
      code: "QUALIFICATION_NOT_READY"
    });
  }
  let doc = await getQualificationDoc(uid, setup.accountId);
  if (!doc) throw Object.assign(new Error("QUALIFICATION_NOT_STARTED"), { code: "QUALIFICATION_NOT_STARTED" });
  const state = deriveAdvancedState(doc);
  if (state !== "DEMO_AUTO_READY" && doc.state !== "DEMO_AUTO_READY") {
    throw Object.assign(new Error("DEMO_AUTO_NOT_READY"), { code: "DEMO_AUTO_NOT_READY" });
  }
  await saveUserAutoTradeSettings(uid, "demo", {
    autoTradeEnabledIntent: true,
    emergencyStopActive: false
  });
  doc = {
    ...doc,
    demoAutoEnabledAt: new Date().toISOString()
  };
  doc = await appendTransition(doc, "DEMO_AUTO_ENABLED", "user_enable_demo_auto", buildSha());
  doc = await appendTransition(doc, "LIVE_QUALIFICATION", "auto_start_live_qualification", buildSha());
  await saveQualificationDoc(doc);
  return getQualificationView(uid);
}

export async function onEmergencyStopQualification(uid: string, active: boolean): Promise<void> {
  const setup = await loadSetupSnapshot(uid);
  if (!setup.accountId) return;
  let doc = await getQualificationDoc(uid, setup.accountId);
  if (!doc) return;
  if (active) {
    doc = {
      ...doc,
      pausedFrom: doc.state === "PAUSED" ? doc.pausedFrom : doc.state
    };
    doc = await appendTransition(doc, "BLOCKED", "emergency_stop", buildSha());
    await saveQualificationDoc(doc);
  } else if (doc.state === "BLOCKED") {
    const resumeTo = deriveAdvancedState({
      ...doc,
      state: doc.pausedFrom ?? "PREVIEW_QUALIFICATION"
    });
    doc = { ...doc, pausedFrom: null };
    doc = await appendTransition(doc, resumeTo, "emergency_stop_cleared", buildSha());
    await saveQualificationDoc(doc);
  }
}

function decisionGeometry(d: DecisionRecord): {
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
} {
  const entry = d.entry?.price ?? null;
  const stopLoss = d.stopLoss?.price ?? null;
  const takeProfit = d.takeProfits?.[0]?.price ?? null;
  return { entry, stopLoss, takeProfit };
}

/**
 * Process a stored decision for qualification (preview count and/or Demo submission).
 */
export async function processDecisionForQualification(args: {
  uid: string;
  decisionId: string;
  store: GoldMetaStore;
}): Promise<{ handled: boolean; message: string }> {
  const { uid, decisionId, store } = args;
  const setup = await loadSetupSnapshot(uid);
  if (!setup.accountId || setup.accountIsLive || setup.emergencyStopActive) {
    return { handled: false, message: "setup_or_live_or_stop" };
  }

  let doc = await getQualificationDoc(uid, setup.accountId);
  if (!doc?.startedAt) return { handled: false, message: "not_started" };
  if (doc.state === "PAUSED" || doc.state === "BLOCKED") {
    return { handled: false, message: "paused_or_blocked" };
  }

  doc.safetyChecks = certifySafetyChecks(doc.safetyChecks, setup);
  let state = deriveAdvancedState(doc);
  if (state !== doc.state) {
    doc = await appendTransition(doc, state, "auto_before_decision", buildSha());
  }

  const d = await store.getDecision(uid, decisionId);
  if (!d) return { handled: false, message: "no_decision" };

  const direction = String(d.decision ?? "WAIT").toUpperCase();
  if (direction !== "BUY" && direction !== "SELL") {
    return { handled: false, message: "wait_hold_ignored" };
  }

  const { entry, stopLoss, takeProfit } = decisionGeometry(d);
  const signalId = d.decisionId;
  const settings = await getUserAutoTradeSettings(uid, "demo");
  const diagnostics = await buildDiagnostics(uid);
  const quote = diagnostics.quote;
  const quoteAgeSeconds =
    quote?.timestamp != null
      ? Math.max(0, (Date.now() - Date.parse(quote.timestamp)) / 1000)
      : null;

  const alreadyCounted =
    doc.previewSignalIds.includes(signalId) ||
    doc.controlledTrades.some((t) => t.signalId === signalId) ||
    doc.demoAutoTrades.some((t) => t.signalId === signalId);

  const candidate = evaluateQualificationCandidate({
    direction,
    signalId,
    entry,
    stopLoss,
    takeProfit,
    confidence: d.confidence ?? null,
    minConfidence: settings.minConfidence,
    quoteBid: quote?.bid ?? null,
    quoteAsk: quote?.ask ?? null,
    quoteSpread: quote?.spread ?? null,
    quoteStale: Boolean(quote?.stale),
    marketStatus: quote?.marketStatus ?? null,
    maxSpread: settings.maxSpread,
    maxQuoteAgeSeconds: settings.maxQuoteAgeSeconds,
    quoteAgeSeconds,
    alreadyCountedSignal: alreadyCounted
  });

  if (state === "PREVIEW_QUALIFICATION") {
    if (!candidate.ok) return { handled: true, message: `preview_rejected:${candidate.failed[0]}` };
    const row: QualificationPreviewRecord = {
      id: newId("prev"),
      signalId,
      at: new Date().toISOString(),
      direction: direction as "BUY" | "SELL",
      entry,
      stopLoss,
      takeProfit,
      confidence: d.confidence ?? null,
      riskResult: "PASS",
      status: "PASSED"
    };
    const next = tryAddPreview(doc, row);
    if (!next) return { handled: true, message: "preview_duplicate_or_full" };
    doc = next;
    if (doc.previewCount >= QUALIFICATION_GATES.requiredPreviews) {
      doc = await appendTransition(
        doc,
        "CONTROLLED_DEMO_QUALIFICATION",
        "previews_complete",
        buildSha()
      );
    }
    await saveQualificationDoc(doc);
    return { handled: true, message: "preview_counted" };
  }

  if (
    state === "CONTROLLED_DEMO_QUALIFICATION" ||
    state === "DEMO_AUTO_ENABLED" ||
    state === "LIVE_QUALIFICATION"
  ) {
    if (!allowsDemoOrderSubmission(state)) {
      return { handled: false, message: "orders_not_allowed" };
    }
    if (!candidate.ok) {
      doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
      await saveQualificationDoc(doc);
      return { handled: true, message: `controlled_blocked:${candidate.failed[0]}` };
    }
    if (doc.controlledOpenCount > 0 && state === "CONTROLLED_DEMO_QUALIFICATION") {
      return { handled: true, message: "one_position_rule" };
    }
    if (alreadyCounted) return { handled: true, message: "duplicate_signal" };

    const symbol = diagnostics.symbol;
    if (!symbol?.metadataComplete) {
      doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
      await saveQualificationDoc(doc);
      return { handled: true, message: "symbol_incomplete" };
    }

    const entryPx =
      direction === "BUY" ? (quote?.ask ?? entry) : (quote?.bid ?? entry);
    const sizing = calculateCTraderVolume({
      equity: diagnostics.account?.equity ?? diagnostics.account?.balance ?? null,
      freeMargin: diagnostics.account?.freeMargin ?? null,
      accountCurrency: diagnostics.account?.currency ?? "EUR",
      riskAmountEur: settings.fixedRiskAmount,
      entryPrice: entryPx,
      stopLoss,
      lotSize: symbol.lotSize,
      tickSize: symbol.tickSize,
      minVolume: symbol.minVolume,
      volumeStep: symbol.volumeStep,
      maxVolume: symbol.maxVolume,
      marginPerLot: null,
      eurToAccountRate: 1,
      sizingMode: settings.sizingMode,
      manualLotSize: settings.manualLotSize
    });
    if (!sizing.ok || sizing.volume == null || sizing.volume <= 0) {
      doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
      await saveQualificationDoc(doc);
      return { handled: true, message: "lots_invalid" };
    }

    const correlationId = newId("corr");
    try {
      const result = await submitDemoMarketOrder({
        ownerUid: uid,
        side: direction as "BUY" | "SELL",
        lots: sizing.volume,
        stopLoss,
        takeProfit,
        entryHint: entryPx,
        comment: `GMQ ${correlationId}`,
        label: correlationId.slice(0, 30)
      });

      if (!result.accepted) {
        doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
        await saveQualificationDoc(doc);
        return { handled: true, message: "order_rejected" };
      }

      const trade: ControlledDemoTradeRecord = {
        id: newId("tr"),
        correlationId,
        signalId,
        at: new Date().toISOString(),
        closedAt: null,
        direction: direction as "BUY" | "SELL",
        entry: entryPx,
        stopLoss,
        takeProfit,
        lots: sizing.volume,
        brokerOrderId: result.orderId ?? null,
        brokerPositionId: result.positionId ?? null,
        status: "OPEN",
        pnl: null,
        counted: false
      };

      if (state === "CONTROLLED_DEMO_QUALIFICATION") {
        doc = {
          ...doc,
          controlledTrades: [...doc.controlledTrades, trade],
          firstControlledDemoTradeAt: doc.firstControlledDemoTradeAt ?? trade.at
        };
        doc = recountControlled(doc);
      } else {
        doc = {
          ...doc,
          demoAutoTrades: [
            ...doc.demoAutoTrades,
            {
              id: trade.id,
              correlationId,
              signalId,
              at: trade.at,
              closedAt: null,
              direction: trade.direction,
              status: "OPEN",
              pnl: null,
              counted: false
            }
          ],
          firstDemoAutoTradeAt: doc.firstDemoAutoTradeAt ?? trade.at
        };
        doc = recountDemoAuto(doc);
      }
      await saveQualificationDoc(doc);
      return { handled: true, message: "order_submitted" };
    } catch (e) {
      doc = {
        ...doc,
        controlledBlockedAttempts: doc.controlledBlockedAttempts + 1,
        lastError: e instanceof Error ? e.message : "order_failed"
      };
      await saveQualificationDoc(doc);
      return { handled: true, message: "order_error" };
    }
  }

  await saveQualificationDoc(doc);
  return { handled: false, message: `state_${state}` };
}

/**
 * Mark an open qualification trade closed (idempotent). Counts toward gates only once.
 */
export async function markQualificationTradeClosed(args: {
  uid: string;
  correlationId: string;
  pnl?: number | null;
}): Promise<QualificationPublicView> {
  const setup = await loadSetupSnapshot(args.uid);
  if (!setup.accountId) throw Object.assign(new Error("NO_ACCOUNT"), { code: "NO_ACCOUNT" });
  let doc = await getQualificationDoc(args.uid, setup.accountId);
  if (!doc) throw Object.assign(new Error("QUALIFICATION_NOT_STARTED"), { code: "QUALIFICATION_NOT_STARTED" });

  const now = new Date().toISOString();
  doc = {
    ...doc,
    controlledTrades: doc.controlledTrades.map((t) =>
      t.correlationId === args.correlationId && t.status !== "CLOSED"
        ? {
            ...t,
            status: "CLOSED",
            closedAt: now,
            pnl: args.pnl ?? t.pnl,
            counted: true
          }
        : t
    ),
    demoAutoTrades: doc.demoAutoTrades.map((t) =>
      t.correlationId === args.correlationId && t.status !== "CLOSED"
        ? {
            ...t,
            status: "CLOSED",
            closedAt: now,
            pnl: args.pnl ?? t.pnl,
            counted: true
          }
        : t
    )
  };
  doc = recountControlled(doc);
  doc = recountDemoAuto(doc);
  const advanced = deriveAdvancedState(doc);
  if (advanced !== doc.state && doc.state !== "PAUSED" && doc.state !== "BLOCKED") {
    doc = await appendTransition(doc, advanced, "trade_closed", buildSha());
  }
  await saveQualificationDoc(doc);
  return getQualificationView(args.uid);
}

export { allowsDemoOrderSubmission, QUALIFICATION_GATES };
export type { QualificationState, QualificationPublicView };
