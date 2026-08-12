/**
 * AutoTrade qualification orchestration — persistent, per-UID, Demo-only.
 */

import { randomBytes } from "crypto";
import { getConnection } from "./connectionStore";
import {
  buildDiagnostics,
  ensureFreshAccessToken
} from "./connectionService";
import {
  getUserAutoTradeSettings,
  saveUserAutoTradeSettings
} from "./userAutoTradeSettings";
import { submitDemoMarketOrder } from "./demoOrderExecution";
import { isCTraderDemoOrderSubmissionEnabled, isCTraderLiveEnabled } from "./flags";
import {
  AUTONOMOUS_DEMO_ORDER_STATES,
  assertAutonomousDemoSubmissionAllowed,
  evaluateControlledDemoOrderAuthority,
  resolveDemoAutoAuthorityForUser
} from "./demoAutoExecutionAuthority";
import {
  applyRiskMultiplier,
  barsRemainingInArmedWindow,
  classifyDemoSetupTier,
  demoRiskMultiplier,
  demoSessionPolicyAllows,
  formatOpportunityActivity,
  hasFastDirectionalConfirmation,
  hasMeaningfulStructuralSupport,
  isHardSessionPlanInvalidator,
  isPlanRefreshUnavailableState,
  isValidDemoRiskMultiplier,
  loadDemoOpportunityConfig,
  markPriceForInvalidation,
  resolveExecutionSetupTier,
  resolveTradingSessionBucket
} from "./demoOpportunityEngine";
import { calculateCTraderVolume } from "./sizing";
import { resolvePepperstoneXauUsdDemoMapping } from "./brokerUnitMappings";
import { calculatePepperstoneXauUsdDemoVolume } from "./demoXauUsdSizing";
import { assertDemoAuthoritativeMarginGate } from "./demoMarginService";
import { resolveQuoteToDepositFx } from "./quoteToDepositFx";
import { createOpenApiClient } from "./openApiClient";
import { lotsToOrderVolumeUnits } from "./volumeUnits";
import { getDailySafetyDoc } from "./dailySafetyStore";
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
  DemoAutoTradeRecord,
  QualificationDocument,
  QualificationPreviewRecord,
  QualificationPublicView,
  QualificationState,
  SafetyCheckRecord
} from "./qualificationTypes";
import { QUALIFICATION_GATES } from "./qualificationTypes";
import {
  appendEvaluation,
  countEvaluationsForDay,
  listRecentEvaluations,
  reasonLabelFor
} from "./evaluationLogStore";
import { tradingDayKey } from "./dailySafetyStore";
import {
  assertEntryAllowed,
  markTradeClosed,
  markTradeOpened
} from "./dailySafetyService";
import { sessionAllowed } from "./sessionGuard";
import { evaluateNewsGuardAsync } from "./newsGuard";
import {
  createAutoTradeJournalEntry,
  updateAutoTradeJournalOnClose
} from "./autoTradeJournal";
import { createDemoPositionLifecycle } from "./demoPositionLifecycle";
import { strategyProvidedTakeProfits } from "./positionLifecycleTypes";
import { newsProtectionBlocksLiveActivation } from "./liveNewsGate";
import { notifyAutoTradeEvent } from "./autoTradeNotifications";
import { isDemoProfitLockLadderEnabled } from "./demoProfitLockFlag";
import { logger } from "../../logging/logger";
import {
  evaluateArmedCandidateLifecycle,
  markExecutionAttempted,
  type ArmedCandidate
} from "./armedCandidate";
import {
  clearArmedCandidate,
  getArmedCandidate,
  saveArmedCandidate
} from "./armedCandidateStore";

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

async function applyLiveNewsActivationGate(
  uid: string,
  view: QualificationPublicView
): Promise<QualificationPublicView> {
  if (!view.canBeginLiveActivation) return view;
  try {
    const [demo, live] = await Promise.all([
      getUserAutoTradeSettings(uid, "demo"),
      getUserAutoTradeSettings(uid, "live")
    ]);
    const gate = newsProtectionBlocksLiveActivation({
      newsFilterEnabled: live.newsFilterEnabled || demo.newsFilterEnabled,
      newsImpactMode: live.newsFilterEnabled
        ? live.newsImpactMode
        : demo.newsImpactMode
    });
    if (!gate.blocked) return view;
    return {
      ...view,
      canBeginLiveActivation: false,
      nextRequirement: gate.reason ?? view.nextRequirement
    };
  } catch {
    return {
      ...view,
      canBeginLiveActivation: false,
      nextRequirement:
        "Economic calendar protection must be configured before Live Auto."
    };
  }
}

export async function getQualificationView(uid: string): Promise<QualificationPublicView> {
  const setup = await loadSetupSnapshot(uid);
  const blockers = buildSetupBlockers(setup);
  const ready = setupReady(blockers);

  if (setup.accountIsLive) {
    return applyLiveNewsActivationGate(
      uid,
      toPublicView({
        doc: null,
        setup,
        stateOverride: "SETUP_REQUIRED"
      })
    );
  }

  let doc = await loadOrInitDoc(uid, setup);
  if (doc && doc.accountId !== setup.accountId && setup.accountId) {
    // Qualification belongs to another Demo account.
    const view = toPublicView({ doc, setup });
    return applyLiveNewsActivationGate(uid, {
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
    });
  }

  if (doc) {
    const before = JSON.stringify(doc.safetyChecks);
    const advanced = deriveAdvancedState(doc);
    if (advanced !== doc.state && doc.state !== "PAUSED" && doc.state !== "BLOCKED") {
      doc = await appendTransition(doc, advanced, "auto_evaluate", buildSha());
      await saveQualificationDoc(doc);
    } else if (JSON.stringify(doc.safetyChecks) !== before) {
      await saveQualificationDoc(doc);
    }
  }

  const view = toPublicView({
    doc,
    setup,
    stateOverride: !ready && !doc?.startedAt ? "SETUP_REQUIRED" : undefined
  });
  try {
    const day = tradingDayKey();
    const [todayActivity, recent] = await Promise.all([
      countEvaluationsForDay(uid, day),
      listRecentEvaluations(uid, 24)
    ]);
    return applyLiveNewsActivationGate(uid, {
      ...view,
      todayActivity,
      recentEvaluations: recent.map((r) => ({
        at: r.at,
        direction: r.direction,
        outcome: r.outcome,
        reasonCode: r.reasonCode,
        reasonLabel: r.reasonLabel,
        finalReason: r.finalReason ?? null,
        confidence: r.confidence,
        spread: r.spread,
        maxSpread: r.maxSpread,
        riskReward: r.riskReward,
        passed: r.passed,
        failed: r.failed
      }))
    });
  } catch {
    return applyLiveNewsActivationGate(uid, view);
  }
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
  if (isCTraderLiveEnabled()) {
    throw Object.assign(new Error("LIVE_EXECUTION_FORBIDDEN"), {
      code: "LIVE_EXECUTION_FORBIDDEN"
    });
  }
  let doc = await getQualificationDoc(uid, setup.accountId);
  if (!doc) throw Object.assign(new Error("QUALIFICATION_NOT_STARTED"), { code: "QUALIFICATION_NOT_STARTED" });
  const state = deriveAdvancedState(doc);
  // Owner Demo start: when Demo paper submission is enabled and the Pepperstone
  // Demo account is ready, Demo Auto may be enabled. Historical preview/controlled
  // gates remain as progress reporting (see evaluateDemoAutoQualification).
  // Live stays impossible.
  const demoStartReady =
    isCTraderDemoOrderSubmissionEnabled() &&
    setup.oauthConnected &&
    setup.demoAccountSelected &&
    !setup.accountIsLive &&
    setup.tradingScope &&
    !setup.emergencyStopActive &&
    Boolean(doc.startedAt) &&
    state !== "PAUSED" &&
    state !== "BLOCKED";
  if (
    state !== "DEMO_AUTO_READY" &&
    doc.state !== "DEMO_AUTO_READY" &&
    !demoStartReady
  ) {
    throw Object.assign(new Error("DEMO_AUTO_NOT_READY"), { code: "DEMO_AUTO_NOT_READY" });
  }
  if (
    state === "DEMO_AUTO_ENABLED" ||
    state === "LIVE_QUALIFICATION" ||
    doc.demoAutoEnabledAt
  ) {
    await saveUserAutoTradeSettings(uid, "demo", {
      autoTradeEnabledIntent: true,
      emergencyStopActive: false,
      autoTradePaused: false
    });
    return getQualificationView(uid);
  }
  await saveUserAutoTradeSettings(uid, "demo", {
    autoTradeEnabledIntent: true,
    emergencyStopActive: false,
    autoTradePaused: false
  });
  doc = {
    ...doc,
    demoAutoEnabledAt: new Date().toISOString()
  };
  doc = await appendTransition(
    doc,
    "DEMO_AUTO_ENABLED",
    demoStartReady && state !== "DEMO_AUTO_READY"
      ? "owner_demo_start_enable_demo_auto"
      : "user_enable_demo_auto",
    buildSha()
  );
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
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
} {
  const entry = d.entry?.price ?? null;
  const stopLoss = d.stopLoss?.price ?? null;
  const tps = strategyProvidedTakeProfits(d.takeProfits);
  return {
    entry,
    stopLoss,
    takeProfit: tps.tp1,
    tp1: tps.tp1,
    tp2: tps.tp2,
    tp3: tps.tp3
  };
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
    if (setup.emergencyStopActive || setup.accountIsLive) {
      await clearArmedCandidate(uid).catch(() => undefined);
    }
    return { handled: false, message: "setup_or_live_or_stop" };
  }

  let doc = await getQualificationDoc(uid, setup.accountId);
  if (!doc?.startedAt) {
    // Never silently drop an actionable decision — record QUALIFICATION_NOT_STARTED.
    // Do NOT execute an order. Do NOT count as a qualifying preview.
    try {
      const pending = await store.getDecision(uid, decisionId);
      const dir = String(pending?.decision ?? "WAIT").toUpperCase();
      if (pending && (dir === "BUY" || dir === "SELL")) {
        const geom = decisionGeometry(pending);
        const score =
          typeof pending.setupScore === "number"
            ? pending.setupScore
            : typeof pending.confidence === "number"
              ? pending.confidence
              : null;
        await appendEvaluation({
          uid,
          accountMasked: setup.accountMasked,
          at: new Date().toISOString(),
          tradingDay: tradingDayKey(),
          stage: "qualification",
          direction: dir,
          signalId: decisionId,
          decisionId,
          confidence: score,
          entry: geom.entry,
          stopLoss: geom.stopLoss,
          takeProfit: geom.takeProfit,
          riskReward: null,
          spread: null,
          maxSpread: null,
          outcome: "REJECTED",
          reasonCode: "QUALIFICATION_NOT_STARTED",
          reasonLabel: reasonLabelFor("QUALIFICATION_NOT_STARTED"),
          passed: [],
          failed: ["QUALIFICATION_NOT_STARTED"],
          pipeline: {
            executionAuthority: "OFF",
            brokerSubmissionAttempted: false,
            brokerOrderIdMasked: null
          },
          finalReason: "Demo Auto qualification was not started"
        });
      }
    } catch (err) {
      logger.warn("Failed to audit QUALIFICATION_NOT_STARTED", {
        uid,
        decisionId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
    return { handled: false, message: "not_started" };
  }
  if (doc.state === "PAUSED" || doc.state === "BLOCKED") {
    await clearArmedCandidate(uid).catch(() => undefined);
    return { handled: false, message: "paused_or_blocked" };
  }

  doc.safetyChecks = certifySafetyChecks(doc.safetyChecks, setup);
  let state = deriveAdvancedState(doc);
  if (state !== doc.state) {
    doc = await appendTransition(doc, state, "auto_before_decision", buildSha());
  }

  const d = await store.getDecision(uid, decisionId);
  if (!d) return { handled: false, message: "no_decision" };

  const settings = await getUserAutoTradeSettings(uid, "demo");
  if (settings.autoTradePaused || settings.emergencyStopActive) {
    const existingArmed = await getArmedCandidate(uid).catch(() => null);
    if (existingArmed) {
      await clearArmedCandidate(uid).catch(() => undefined);
      logger.info("AutoTrade armed candidate invalidated", {
        uid,
        candidateId: existingArmed.candidateId,
        reason: settings.emergencyStopActive ? "emergency_stop" : "paused"
      });
    }
    return { handled: false, message: settings.emergencyStopActive ? "emergency_stop" : "paused" };
  }

  const diagnostics = await buildDiagnostics(uid);
  const quote = diagnostics.quote;
  const quoteAgeSeconds =
    quote?.timestamp != null
      ? Math.max(0, (Date.now() - Date.parse(quote.timestamp)) / 1000)
      : null;

  const decisionDirection = String(d.decision ?? "WAIT").toUpperCase();
  const geom = decisionGeometry(d);
  const sessionPlan = (await store.getActiveSessionPlan?.(uid)) ?? null;
  const confirmationState =
    sessionPlan?.confirmationState ??
    d.marketStructure?.confirmationClassification ??
    null;
  const candleClassification = d.marketStructure?.confirmationClassification ?? null;
  const planSourceKey = sessionPlan?.planSourceKey ?? null;
  const orderStates =
    state === "CONTROLLED_DEMO_QUALIFICATION" ||
    state === "DEMO_AUTO_ENABLED" ||
    state === "LIVE_QUALIFICATION";

  // --- Internal armed-candidate lifecycle (order states only; no UI) ---
  let armedTrade: ArmedCandidate | null = null;
  if (orderStates) {
    const existingArmed = await getArmedCandidate(uid).catch(() => null);
    const alreadyCountedArmed = existingArmed
      ? doc.controlledTrades.some((t) => t.signalId === existingArmed.signalId) ||
        doc.demoAutoTrades.some((t) => t.signalId === existingArmed.signalId)
      : false;

    const oppConfig = loadDemoOpportunityConfig();

    // Autonomous Demo Auto: authority loss must cancel an armed thesis so a
    // stale candidate cannot fire immediately after re-enable.
    // CONTROLLED_DEMO_QUALIFICATION keeps its separately documented semantics.
    let autoTradePermitted =
      !settings.autoTradePaused && !settings.emergencyStopActive;
    let autoTradeOffReason: string | null = settings.emergencyStopActive
      ? "EMERGENCY_STOP"
      : settings.autoTradePaused
        ? "AUTOTRADE_PAUSED"
        : null;
    if (
      AUTONOMOUS_DEMO_ORDER_STATES.includes(state) &&
      !isCTraderLiveEnabled()
    ) {
      const demoAuthority = await resolveDemoAutoAuthorityForUser(uid);
      if (!demoAuthority.submissionAuthorized) {
        autoTradePermitted = false;
        autoTradeOffReason =
          demoAuthority.reasons[0] ??
          (demoAuthority.emergencyStop
            ? "EMERGENCY_STOP"
            : demoAuthority.paused
              ? "AUTOTRADE_PAUSED"
              : !demoAuthority.intentEnabled
                ? "AUTOTRADE_INTENT_OFF"
                : !demoAuthority.selectedDemoAccount
                  ? "DEMO_ACCOUNT_NOT_SELECTED"
                  : demoAuthority.tradingScope !== "trading"
                    ? "TRADING_OAUTH_REQUIRED"
                    : !demoAuthority.demoSubmissionFlag
                      ? "DEMO_SUBMISSION_FLAG_OFF"
                      : "EXECUTION_AUTHORITY_OFF");
      }
    }

    let qualifiedSetup: {
      direction: "BUY" | "SELL";
      signalId: string;
      planSourceKey: string | null;
      entry: number;
      stopLoss: number;
      takeProfit: number;
      confidence: number | null;
      setupScore: number | null;
    } | null = null;

    if (
      (decisionDirection === "BUY" || decisionDirection === "SELL") &&
      (geom.entry == null || geom.stopLoss == null || geom.takeProfit == null)
    ) {
      try {
        await appendEvaluation({
          uid,
          accountMasked: setup.accountMasked,
          at: new Date().toISOString(),
          tradingDay: tradingDayKey(),
          stage: state,
          direction: decisionDirection,
          signalId: d.decisionId,
          confidence: d.confidence ?? null,
          entry: geom.entry,
          stopLoss: geom.stopLoss,
          takeProfit: geom.takeProfit,
          riskReward: null,
          spread: quote?.spread ?? null,
          maxSpread: settings.maxSpread,
          outcome: "REJECTED",
          reasonCode: "INCOMPLETE_GEOMETRY",
          reasonLabel: reasonLabelFor("INCOMPLETE_GEOMETRY"),
          passed: [],
          failed: ["INCOMPLETE_GEOMETRY"]
        });
      } catch {
        /* ignore */
      }
      if (!existingArmed) {
        return { handled: true, message: "arm_hard_reject:INCOMPLETE_GEOMETRY" };
      }
    }

    if (
      (decisionDirection === "BUY" || decisionDirection === "SELL") &&
      geom.entry != null &&
      geom.stopLoss != null &&
      geom.takeProfit != null
    ) {
      const preCandidate = evaluateQualificationCandidate({
        direction: decisionDirection,
        signalId: d.decisionId,
        entry: geom.entry,
        stopLoss: geom.stopLoss,
        // RR / geometry quality against TP2 when present (see order-path note below).
        takeProfit: geom.tp2 ?? geom.tp3 ?? geom.takeProfit,
        confidence: d.confidence ?? null,
        minConfidence: settings.minConfidence,
        minRiskReward: settings.minRiskReward,
        quoteBid: quote?.bid ?? null,
        quoteAsk: quote?.ask ?? null,
        quoteSpread: quote?.spread ?? null,
        quoteStale: Boolean(quote?.stale),
        marketStatus: quote?.marketStatus ?? null,
        maxSpread: settings.maxSpread,
        maxQuoteAgeSeconds: settings.maxQuoteAgeSeconds,
        quoteAgeSeconds,
        alreadyCountedSignal: false,
        requireMarketOpen: true
      });
      // Soft quote/session failures must not prevent arming a valid setup thesis;
      // final safety still runs before any order. Hard geometry/confidence still required.
      const hardFail = preCandidate.failed.some((f) =>
        [
          "NOT_ACTIONABLE",
          "INCOMPLETE_GEOMETRY",
          "GEOMETRY_DIRECTION_INVALID",
          "CONFIDENCE_TOO_LOW",
          "RR_TOO_LOW"
        ].includes(f)
      );
      if (!hardFail) {
        const setupTierPre = classifyDemoSetupTier(
          d.setupScore ?? null,
          oppConfig
        );
        // ACTIVE_DEMO: setupScore tier is authoritative — confidence alone must
        // not arm/execute BELOW-A setups.
        if (oppConfig.mode === "ACTIVE_DEMO" && setupTierPre === "BELOW") {
          try {
            await appendEvaluation({
              uid,
              accountMasked: setup.accountMasked,
              at: new Date().toISOString(),
              tradingDay: tradingDayKey(),
              stage: state,
              direction: decisionDirection,
              signalId: d.decisionId,
              decisionId: d.decisionId,
              confidence: d.setupScore ?? d.confidence ?? null,
              entry: geom.entry,
              stopLoss: geom.stopLoss,
              takeProfit: geom.takeProfit,
              riskReward: null,
              spread: quote?.spread ?? null,
              maxSpread: settings.maxSpread,
              outcome: "REJECTED",
              reasonCode: "TIER_BELOW_A",
              reasonLabel: reasonLabelFor("TIER_BELOW_A"),
              passed: preCandidate.passed,
              failed: ["TIER_BELOW_A"],
              finalReason: `SETUP ${decisionDirection} ${
                d.setupScore != null ? Math.round(d.setupScore) : "?"
              }/100 skipped — TIER_BELOW_A (setup score below A threshold; confidence is not a substitute)`
            });
          } catch {
            /* ignore */
          }
          if (!existingArmed) {
            return { handled: true, message: "arm_hard_reject:TIER_BELOW_A" };
          }
          // Keep monitoring existing armed A/A+ thesis; do not arm/replace with BELOW.
        } else {
          qualifiedSetup = {
            direction: decisionDirection,
            signalId: d.decisionId,
            planSourceKey,
            entry: geom.entry,
            stopLoss: geom.stopLoss,
            takeProfit: geom.takeProfit,
            confidence: d.confidence ?? null,
            setupScore: d.setupScore ?? null
          };
          logger.info("AutoTrade setup qualified", {
            uid,
            signalId: d.decisionId,
            direction: decisionDirection,
            setupScore: d.setupScore ?? null,
            tier: setupTierPre
          });
        }
      } else {
        // Persist arm-stage hard rejects so missed BUY/SELL never disappear silently.
        try {
          await appendEvaluation({
            uid,
            accountMasked: setup.accountMasked,
            at: new Date().toISOString(),
            tradingDay: tradingDayKey(),
            stage: state,
            direction: decisionDirection,
            signalId: d.decisionId,
            confidence: d.confidence ?? null,
            entry: geom.entry,
            stopLoss: geom.stopLoss,
            takeProfit: geom.takeProfit,
            riskReward: null,
            spread: quote?.spread ?? null,
            maxSpread: settings.maxSpread,
            outcome: "REJECTED",
            reasonCode: preCandidate.failed[0] ?? "REJECTED",
            reasonLabel: reasonLabelFor(preCandidate.failed[0] ?? "REJECTED"),
            passed: preCandidate.passed,
            failed: preCandidate.failed
          });
        } catch {
          /* never block on log failure */
        }
        logger.info("AutoTrade setup hard-rejected before arm", {
          uid,
          signalId: d.decisionId,
          direction: decisionDirection,
          failed: preCandidate.failed
        });
        // No existing armed thesis to monitor — stop here (avoid silent fallthrough).
        if (!existingArmed) {
          return {
            handled: true,
            message: `arm_hard_reject:${preCandidate.failed[0] ?? "REJECTED"}`
          };
        }
      }
    }

    const planLifecycle = sessionPlan?.lifecycleState ?? null;
    // ACTIVE_DEMO: NO_VALID_PLAN alone must NOT kill an armed thesis.
    // NO_TRADE remains a hard invalidator (GoldMeta non-actionable).
    const planRefreshUnavailable =
      Boolean(existingArmed) &&
      oppConfig.mode === "ACTIVE_DEMO" &&
      isPlanRefreshUnavailableState(planLifecycle);
    const oppositePlanDirection =
      Boolean(existingArmed) &&
      sessionPlan?.direction != null &&
      existingArmed != null &&
      sessionPlan.direction !== existingArmed.direction &&
      sessionPlan.direction !== "WAIT" &&
      // Only treat as hard invalidator when plan is still a real directional plan
      !isPlanRefreshUnavailableState(planLifecycle) &&
      !isHardSessionPlanInvalidator(planLifecycle);
    const structurallyInvalid =
      Boolean(existingArmed) &&
      (isHardSessionPlanInvalidator(planLifecycle) ||
        (oppConfig.mode === "STRICT" &&
          isPlanRefreshUnavailableState(planLifecycle)) ||
        oppositePlanDirection);

    const decisionReasons: string[] = Array.isArray(
      (d as { reasons?: string[] }).reasons
    )
      ? ((d as { reasons?: string[] }).reasons as string[])
      : Array.isArray((d as { reasonCodes?: string[] }).reasonCodes)
        ? ((d as { reasonCodes?: string[] }).reasonCodes as string[])
        : [];

    const markSide =
      existingArmed != null
        ? markPriceForInvalidation({
            direction: existingArmed.direction,
            bid: quote?.bid ?? null,
            ask: quote?.ask ?? null
          })
        : null;

    const life = evaluateArmedCandidateLifecycle({
      uid,
      nowIso: new Date().toISOString(),
      autoTradePermitted,
      autoTradeOffReason,
      existing:
        existingArmed == null
          ? null
          : alreadyCountedArmed
            ? { ...existingArmed, executionAttempted: true }
            : existingArmed,
      qualifiedSetup: qualifiedSetup
        ? {
            ...qualifiedSetup,
            takeProfit2: geom.tp2,
            takeProfit3: geom.tp3,
            originalReasons: decisionReasons
          }
        : null,
      confirmationRequired: settings.confirmationCandleRequired,
      confirmationState,
      candleClassification,
      sessionPlanValidUntil: null, // do not bind armed expiry to plan refresh
      structurallyInvalid,
      structuralReason: structurallyInvalid
        ? oppositePlanDirection
          ? "SESSION_PLAN_OPPOSITE_DIRECTION"
          : `SESSION_PLAN_${planLifecycle ?? "INVALID"}`
        : null,
      planRefreshUnavailable,
      markPrice: markSide,
      opportunityConfig: oppConfig,
      decisionReasons,
      allowFastConfirmation:
        oppConfig.mode === "ACTIVE_DEMO" &&
        classifyDemoSetupTier(
          qualifiedSetup?.setupScore ?? existingArmed?.setupScore,
          oppConfig
        ) === "A_PLUS" &&
        hasMeaningfulStructuralSupport(decisionReasons) &&
        hasFastDirectionalConfirmation({
          direction: (qualifiedSetup?.direction ??
            existingArmed?.direction ??
            "BUY") as "BUY" | "SELL",
          reasons: decisionReasons,
          confirmationClassification:
            candleClassification ?? confirmationState
        })
    });

    if (life.action === "INVALIDATE" && life.candidate) {
      await clearArmedCandidate(uid).catch(() => undefined);
      const invTier = resolveExecutionSetupTier({
        armedTier: life.candidate.tier,
        setupScore: life.candidate.setupScore,
        config: oppConfig
      });
      const expired =
        life.candidate.invalidationReason === "ARMED_WINDOW_EXPIRED" ||
        life.reasonCode === "CANDIDATE_INVALIDATED_STALE";
      const cancelLabel = formatOpportunityActivity({
        tier: invTier,
        direction: life.candidate.direction,
        score: life.candidate.setupScore ?? life.candidate.confidence,
        event: expired ? "EXPIRED" : "CANCELLED_INVALIDATED",
        invalidationDetail:
          life.candidate.invalidationReason?.replace(/_/g, " ").toLowerCase() ||
          "setup invalidated"
      });
      logger.info("AutoTrade armed candidate invalidated", {
        uid,
        candidateId: life.candidate.candidateId,
        reason: life.reasonCode,
        detail: life.candidate.invalidationReason
      });
      try {
        await appendEvaluation({
          uid,
          accountMasked: setup.accountMasked,
          at: new Date().toISOString(),
          tradingDay: tradingDayKey(),
          stage: state,
          direction: life.candidate.direction,
          signalId: life.candidate.signalId,
          decisionId: life.candidate.signalId,
          confidence: life.candidate.setupScore ?? life.candidate.confidence,
          entry: life.candidate.entry,
          stopLoss: life.candidate.stopLoss,
          takeProfit: life.candidate.takeProfit,
          riskReward: null,
          spread: quote?.spread ?? null,
          maxSpread: settings.maxSpread,
          outcome: "IGNORED",
          reasonCode: life.reasonCode,
          reasonLabel: cancelLabel,
          passed: [],
          failed: [life.candidate.invalidationReason ?? life.reasonCode],
          finalReason: cancelLabel
        });
      } catch {
        /* ignore */
      }
      return { handled: true, message: "armed_invalidated" };
    }

    const readyToExecute =
      life.action === "READY_TO_EXECUTE" ||
      (life.action === "REPLACE_WITH_OPPOSITE" &&
        (life.reasonCode === "OPPOSITE_SETUP_READY" ||
          life.reasonCode === "ENTRY_CONFIRMATION_RECEIVED" ||
          life.reasonCode === "FAST_CONFIRMATION_RECEIVED"));

    if (
      !readyToExecute &&
      (life.action === "ARM" ||
        life.action === "KEEP_WAITING" ||
        life.action === "REPLACE_WITH_OPPOSITE") &&
      life.candidate
    ) {
      if (
        life.reasonCode === "EXECUTION_ALREADY_ATTEMPTED" ||
        life.candidate.executionAttempted
      ) {
        await clearArmedCandidate(uid).catch(() => undefined);
        return { handled: true, message: "armed_duplicate_suppressed" };
      }
      await saveArmedCandidate({ ...life.candidate, uid }).catch(() => undefined);
      const tier = resolveExecutionSetupTier({
        armedTier: life.candidate.tier,
        setupScore: life.candidate.setupScore,
        config: oppConfig
      });
      const barsLeft = barsRemainingInArmedWindow({
        armedAt: life.candidate.armedAt,
        nowIso: new Date().toISOString(),
        bars5m: oppConfig.armedConfirmationBars5m
      });
      const activityEvent =
        life.reasonCode === "PLAN_REFRESH_UNAVAILABLE" ||
        life.candidate.planRefreshNote === "PLAN_REFRESH_UNAVAILABLE"
          ? ("PLAN_REFRESH_UNAVAILABLE" as const)
          : ("ARMED_WAITING" as const);
      const activityLabel = formatOpportunityActivity({
        tier,
        direction: life.candidate.direction,
        score: life.candidate.setupScore ?? life.candidate.confidence,
        event: activityEvent,
        barsRemaining: barsLeft
      });
      logger.info("AutoTrade armed candidate waiting for confirmation", {
        uid,
        candidateId: life.candidate.candidateId,
        direction: life.candidate.direction,
        reason: life.reasonCode,
        confirmationState,
        tier,
        barsLeft
      });
      try {
        await appendEvaluation({
          uid,
          accountMasked: setup.accountMasked,
          at: new Date().toISOString(),
          tradingDay: tradingDayKey(),
          stage: state,
          direction: life.candidate.direction,
          signalId: life.candidate.signalId,
          decisionId: life.candidate.signalId,
          confidence: life.candidate.setupScore ?? life.candidate.confidence,
          entry: life.candidate.entry,
          stopLoss: life.candidate.stopLoss,
          takeProfit: life.candidate.takeProfit,
          riskReward: null,
          spread: quote?.spread ?? null,
          maxSpread: settings.maxSpread,
          outcome: "IGNORED",
          reasonCode:
            activityEvent === "PLAN_REFRESH_UNAVAILABLE"
              ? "PLAN_REFRESH_UNAVAILABLE"
              : life.reasonCode,
          reasonLabel: activityLabel,
          passed: ["SETUP_QUALIFIED"],
          failed:
            activityEvent === "PLAN_REFRESH_UNAVAILABLE"
              ? ["PLAN_REFRESH_UNAVAILABLE"]
              : ["CANDLE_CONFIRMATION_REQUIRED"],
          finalReason: activityLabel
        });
      } catch {
        /* ignore */
      }
      return { handled: true, message: `armed_${life.reasonCode.toLowerCase()}` };
    }

    if (readyToExecute && life.candidate) {
      if (life.candidate.executionAttempted || alreadyCountedArmed) {
        await clearArmedCandidate(uid).catch(() => undefined);
        logger.info("AutoTrade duplicate execution suppressed", {
          uid,
          candidateId: life.candidate.candidateId
        });
        return { handled: true, message: "armed_duplicate_suppressed" };
      }
      armedTrade = { ...life.candidate, uid };
      logger.info("AutoTrade entry confirmation received", {
        uid,
        candidateId: armedTrade.candidateId,
        direction: armedTrade.direction,
        signalId: armedTrade.signalId
      });
      await saveArmedCandidate(armedTrade).catch(() => undefined);
    }

    if (
      !armedTrade &&
      (decisionDirection !== "BUY" && decisionDirection !== "SELL")
    ) {
      try {
        await appendEvaluation({
          uid,
          accountMasked: setup.accountMasked,
          at: new Date().toISOString(),
          tradingDay: tradingDayKey(),
          stage: state,
          direction: decisionDirection,
          signalId: decisionId,
          confidence: d.confidence ?? null,
          entry: null,
          stopLoss: null,
          takeProfit: null,
          riskReward: null,
          spread: quote?.spread ?? null,
          maxSpread: settings.maxSpread,
          outcome: "IGNORED",
          reasonCode: "WAIT_HOLD",
          reasonLabel: reasonLabelFor("WAIT_HOLD"),
          passed: [],
          failed: ["NOT_ACTIONABLE"]
        });
      } catch {
        /* ignore */
      }
      return { handled: false, message: "wait_hold_ignored" };
    }
  } else if (decisionDirection !== "BUY" && decisionDirection !== "SELL") {
    try {
      await appendEvaluation({
        uid,
        accountMasked: setup.accountMasked,
        at: new Date().toISOString(),
        tradingDay: tradingDayKey(),
        stage: state,
        direction: decisionDirection,
        signalId: decisionId,
        confidence: d.confidence ?? null,
        entry: null,
        stopLoss: null,
        takeProfit: null,
        riskReward: null,
        spread: null,
        maxSpread: null,
        outcome: "IGNORED",
        reasonCode: "WAIT_HOLD",
        reasonLabel: reasonLabelFor("WAIT_HOLD"),
        passed: [],
        failed: ["NOT_ACTIONABLE"]
      });
    } catch {
      /* ignore */
    }
    return { handled: false, message: "wait_hold_ignored" };
  }

  // Prefer armed candidate geometry when confirmation finally arrives on a later cycle.
  // Original TP2/TP3 must survive WAIT/confirmation cycles that omit them.
  const direction = armedTrade?.direction ?? decisionDirection;
  const entry = armedTrade?.entry ?? geom.entry;
  const stopLoss = armedTrade?.stopLoss ?? geom.stopLoss;
  const takeProfit = armedTrade?.takeProfit ?? geom.takeProfit;
  const tp1 = armedTrade?.takeProfit ?? geom.tp1;
  const tp2 = armedTrade?.takeProfit2 ?? geom.tp2;
  const tp3 = armedTrade?.takeProfit3 ?? geom.tp3;
  const signalId = armedTrade?.signalId ?? d.decisionId;
  const tradeConfidence = armedTrade?.confidence ?? d.confidence ?? null;

  const alreadyCounted =
    doc.previewSignalIds.includes(signalId) ||
    doc.controlledTrades.some((t) => t.signalId === signalId) ||
    doc.demoAutoTrades.some((t) => t.signalId === signalId);

  // Qualification RR gate uses the best strategy TP that exists (TP2/TP3 when
  // present). GoldMeta plans are typically TP1=1R / TP2=2R / TP3=3R — checking
  // only TP1 against minRiskReward (default 1.5) incorrectly rejected every setup.
  // Default order submission still uses strategy TP1 as the broker take-profit.
  // When demoProfitLockLadderEnabled is explicitly true and TP3 exists, the
  // broker hard TP is TP3 (position-management ladder). Missing TP3 keeps
  // existing fail-closed / TP1 behaviour — never invent targets.
  // When confirming a retained armed candidate, RR comes from ORIGINAL geometry.
  const rrTakeProfit = tp2 ?? tp3 ?? takeProfit;
  const risk =
    entry != null && stopLoss != null ? Math.abs(entry - stopLoss) : null;
  const reward =
    entry != null && rrTakeProfit != null ? Math.abs(rrTakeProfit - entry) : null;
  const riskRewardFromGeometry =
    risk && risk > 0 && reward != null ? reward / risk : null;
  const riskRewardFromDecision =
    typeof d.riskReward?.tp2 === "number"
      ? d.riskReward.tp2
      : typeof d.riskReward?.tp3 === "number"
        ? d.riskReward.tp3
        : typeof d.riskReward?.tp1 === "number"
          ? d.riskReward.tp1
          : null;
  const riskReward = armedTrade
    ? riskRewardFromGeometry ?? riskRewardFromDecision
    : riskRewardFromDecision ?? riskRewardFromGeometry;

  const candidate = evaluateQualificationCandidate({
    direction,
    signalId,
    entry,
    stopLoss,
    takeProfit: rrTakeProfit,
    confidence: tradeConfidence,
    minConfidence: settings.minConfidence,
    minRiskReward: settings.minRiskReward,
    quoteBid: quote?.bid ?? null,
    quoteAsk: quote?.ask ?? null,
    quoteSpread: quote?.spread ?? null,
    quoteStale: Boolean(quote?.stale),
    marketStatus: quote?.marketStatus ?? null,
    maxSpread: settings.maxSpread,
    maxQuoteAgeSeconds: settings.maxQuoteAgeSeconds,
    quoteAgeSeconds,
    alreadyCountedSignal: alreadyCounted,
    requireMarketOpen: true
  });

  const session = sessionAllowed(settings.allowedSessions);
  const news = await evaluateNewsGuardAsync({
    mode: settings.newsFilterEnabled ? settings.newsImpactMode : "OFF",
    minutesBefore: settings.newsMinutesBefore,
    minutesAfter: settings.newsMinutesAfter
  });

  const logEval = async (
    outcome: "QUALIFIED" | "REJECTED",
    reasonCode: string,
    failed: string[],
    passed: string[],
    extras?: {
      brokerSubmissionAttempted?: boolean;
      brokerOrderIdMasked?: string | null;
      executionAuthority?: string | null;
    }
  ) => {
    try {
      await appendEvaluation({
        uid,
        accountMasked: setup.accountMasked,
        at: new Date().toISOString(),
        tradingDay: tradingDayKey(),
        stage: state,
        direction,
        signalId,
        decisionId,
        confidence: tradeConfidence,
        entry,
        stopLoss,
        takeProfit,
        riskReward,
        spread: quote?.spread ?? null,
        maxSpread: settings.maxSpread,
        outcome,
        reasonCode,
        reasonLabel: reasonLabelFor(reasonCode),
        passed,
        failed,
        pipeline: {
          confirmation: confirmationState,
          session: session.ok ? "PASS" : "SESSION_BLOCKED",
          news: news.active ? "NEWS_GUARD" : "PASS",
          quoteAge:
            quoteAgeSeconds != null ? `${quoteAgeSeconds.toFixed(1)}s` : null,
          dailyLimits: null,
          openPositions: null,
          armedCandidate: armedTrade ? "ARMED" : null,
          executionAuthority: extras?.executionAuthority ?? null,
          brokerSubmissionAttempted: extras?.brokerSubmissionAttempted ?? false,
          brokerOrderIdMasked: extras?.brokerOrderIdMasked ?? null
        },
        finalReason: outcome === "QUALIFIED" ? null : reasonLabelFor(reasonCode)
      });
    } catch {
      /* never block qualification on log failure */
    }
  };

  if (state === "PREVIEW_QUALIFICATION") {
    if (!session.ok) {
      await logEval("REJECTED", "SESSION_BLOCKED", ["SESSION_BLOCKED"], candidate.passed);
      return { handled: true, message: "preview_rejected:SESSION_BLOCKED" };
    }
    if (news.active) {
      await logEval("REJECTED", "NEWS_GUARD", ["NEWS_GUARD"], candidate.passed);
      return { handled: true, message: "preview_rejected:NEWS_GUARD" };
    }
    if (!candidate.ok) {
      await logEval(
        "REJECTED",
        candidate.failed[0] ?? "REJECTED",
        candidate.failed,
        candidate.passed
      );
      return { handled: true, message: `preview_rejected:${candidate.failed[0]}` };
    }
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
    await logEval("QUALIFIED", "PREVIEW_COUNTED", [], candidate.passed);
    if (doc.previewCount >= QUALIFICATION_GATES.requiredPreviews) {
      doc = await appendTransition(
        doc,
        "CONTROLLED_DEMO_QUALIFICATION",
        "previews_complete",
        buildSha()
      );
      await notifyAutoTradeEvent({
        uid,
        kind: "PREVIEWS_COMPLETE",
        title: "Preview qualification complete",
        body: "Controlled Demo qualification has started.",
        dedupeKey: `previews_complete_${setup.accountId}`
      });
    } else if (doc.previewCount === 10 || doc.previewCount % 5 === 0) {
      await notifyAutoTradeEvent({
        uid,
        kind: "PREVIEW_PROGRESS",
        title: "Preview qualification progress",
        body: `${doc.previewCount} / ${QUALIFICATION_GATES.requiredPreviews} previews complete.`,
        dedupeKey: `preview_progress_${setup.accountId}_${doc.previewCount}`
      });
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
    const entryGate = await assertEntryAllowed(uid, "demo");
    if (!entryGate.allowed) {
      doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
      await saveQualificationDoc(doc);
      await logEval(
        "REJECTED",
        entryGate.code ?? "ENTRIES_PAUSED",
        [entryGate.code ?? "ENTRIES_PAUSED"],
        candidate.passed
      );
      return { handled: true, message: `controlled_blocked:${entryGate.code}` };
    }
    const oppCfg = loadDemoOpportunityConfig();
    // Prefer persisted armed tier so configured thresholds cannot drift.
    // ACTIVE_DEMO never substitutes confidence for a missing setupScore.
    const setupTier = resolveExecutionSetupTier({
      armedTier: armedTrade?.tier,
      setupScore: armedTrade?.setupScore ?? d.setupScore ?? null,
      confidence: tradeConfidence,
      config: oppCfg
    });
    if (oppCfg.mode === "ACTIVE_DEMO" && setupTier === "BELOW") {
      doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
      await saveQualificationDoc(doc);
      await logEval(
        "REJECTED",
        "TIER_BELOW_A",
        ["TIER_BELOW_A"],
        candidate.passed
      );
      return { handled: true, message: "controlled_blocked:TIER_BELOW_A" };
    }
    const sessionBucket = resolveTradingSessionBucket();
    const activeDemoSession = demoSessionPolicyAllows({
      mode: oppCfg.mode,
      allowedSessions: settings.allowedSessions,
      tier: setupTier,
      config: oppCfg
    });
    // ACTIVE_DEMO Asia: experimental A+/A only. Major sessions keep classic allowedSessions.
    const sessionOk =
      oppCfg.mode === "ACTIVE_DEMO" && sessionBucket === "Asia"
        ? activeDemoSession.ok
        : session.ok;
    if (!sessionOk) {
      doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
      await saveQualificationDoc(doc);
      await logEval("REJECTED", "SESSION_BLOCKED", ["SESSION_BLOCKED"], candidate.passed);
      return { handled: true, message: "controlled_blocked:SESSION_BLOCKED" };
    }
    if (news.active) {
      doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
      await saveQualificationDoc(doc);
      await logEval("REJECTED", "NEWS_GUARD", ["NEWS_GUARD"], candidate.passed);
      return { handled: true, message: "controlled_blocked:NEWS_GUARD" };
    }
    if (!candidate.ok) {
      doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
      await saveQualificationDoc(doc);
      logger.info("AutoTrade final safety check failed", {
        uid,
        signalId,
        failed: candidate.failed,
        armed: Boolean(armedTrade)
      });
      await logEval(
        "REJECTED",
        candidate.failed[0] ?? "FINAL_SAFETY_FAILED",
        candidate.failed,
        candidate.passed
      );
      // Keep armed candidate — risk rejection must not bypass gates, and must not
      // forget a still-valid thesis unless duplicate/execution already attempted.
      return { handled: true, message: `controlled_blocked:${candidate.failed[0]}` };
    }
    if (doc.controlledOpenCount > 0 && state === "CONTROLLED_DEMO_QUALIFICATION") {
      await logEval("REJECTED", "ONE_POSITION_RULE", ["ONE_POSITION_RULE"], candidate.passed);
      return { handled: true, message: "one_position_rule" };
    }
    if (alreadyCounted) {
      await clearArmedCandidate(uid).catch(() => undefined);
      return { handled: true, message: "duplicate_signal" };
    }

    const symbol = diagnostics.symbol;
    if (!symbol?.metadataComplete) {
      doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
      await saveQualificationDoc(doc);
      return { handled: true, message: "symbol_incomplete" };
    }

    const entryPx =
      direction === "BUY" ? (quote?.ask ?? entry) : (quote?.bid ?? entry);

    // Pepperstone Demo XAUUSD: proven economic sizing (1 lot = 1 oz) + FX + fail-closed gates.
    // Other broker/symbol paths keep legacy calculateCTraderVolume until separately proven.
    const unitMapping = resolvePepperstoneXauUsdDemoMapping({
      pepperstoneConfirmed: Boolean(diagnostics.pepperstoneConfirmed),
      selectedAccountIsLive: Boolean(diagnostics.selectedAccountIsLive),
      symbolName: symbol.symbolName ?? diagnostics.connection?.symbolName
    });

    let sizedLots: number | null = null;
    let sizingRejectMessage = "lots_invalid";

    if (unitMapping) {
      const connection = await getConnection(uid);
      if (!connection?.selectedAccountId) {
        doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
        await saveQualificationDoc(doc);
        return { handled: true, message: "lots_invalid:NO_ACCOUNT" };
      }

      const daily = await getDailySafetyDoc(uid, "demo");
      const lossUsed = Math.abs(Math.min(0, daily.realisedPnl));
      const remainingDailyLossCapacity = Math.max(
        0,
        settings.maxDailyLoss - lossUsed
      );

      const depositCurrency =
        diagnostics.account?.currency ?? connection.currency ?? null;
      const quoteCurrency = "USD";

      let quoteToDepositRate: number | null = null;
      try {
        const { accessToken, connection: freshConn } =
          await ensureFreshAccessToken(connection);
        const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
        const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
        if (!clientId || !clientSecret) {
          doc = {
            ...doc,
            controlledBlockedAttempts: doc.controlledBlockedAttempts + 1
          };
          await saveQualificationDoc(doc);
          await logEval(
            "REJECTED",
            "CURRENCY_CONVERSION_UNAVAILABLE",
            ["CURRENCY_CONVERSION_UNAVAILABLE"],
            candidate.passed
          );
          return {
            handled: true,
            message: "lots_invalid:CURRENCY_CONVERSION_UNAVAILABLE"
          };
        }
        const fx = await resolveQuoteToDepositFx({
          openApiClient: createOpenApiClient(),
          accessToken,
          clientId,
          clientSecret,
          ctidTraderAccountId: freshConn.selectedAccountId!,
          quoteCurrency,
          depositCurrency: depositCurrency ?? "",
          isLive: Boolean(freshConn.selectedAccountIsLive)
        });
        if (!fx.ok) {
          doc = {
            ...doc,
            controlledBlockedAttempts: doc.controlledBlockedAttempts + 1
          };
          await saveQualificationDoc(doc);
          await logEval(
            "REJECTED",
            fx.reason,
            [fx.reason],
            candidate.passed
          );
          return { handled: true, message: `lots_invalid:${fx.reason}` };
        }
        quoteToDepositRate = fx.rate;
      } catch (fxErr) {
        doc = {
          ...doc,
          controlledBlockedAttempts: doc.controlledBlockedAttempts + 1
        };
        await saveQualificationDoc(doc);
        logger.info("AutoTrade FX conversion failed closed", {
          uid,
          signalId,
          error: fxErr instanceof Error ? fxErr.message : String(fxErr)
        });
        await logEval(
          "REJECTED",
          "CURRENCY_CONVERSION_UNAVAILABLE",
          ["CURRENCY_CONVERSION_UNAVAILABLE"],
          candidate.passed
        );
        return {
          handled: true,
          message: "lots_invalid:CURRENCY_CONVERSION_UNAVAILABLE"
        };
      }

      const riskMult = demoRiskMultiplier({
        tier: setupTier,
        session: sessionBucket,
        config: oppCfg
      });
      let effectiveRisk: number;
      if (oppCfg.mode === "ACTIVE_DEMO") {
        // Fail closed — never fall back to base risk via `riskMult || 1`.
        if (!isValidDemoRiskMultiplier(riskMult)) {
          doc = {
            ...doc,
            controlledBlockedAttempts: doc.controlledBlockedAttempts + 1
          };
          await saveQualificationDoc(doc);
          await logEval(
            "REJECTED",
            "RISK_MULTIPLIER_INVALID",
            ["RISK_MULTIPLIER_INVALID", "TIER_BELOW_A"],
            candidate.passed
          );
          return { handled: true, message: "lots_invalid:RISK_MULTIPLIER_INVALID" };
        }
        effectiveRisk = applyRiskMultiplier(settings.fixedRiskAmount, riskMult);
        if (!(effectiveRisk > 0)) {
          doc = {
            ...doc,
            controlledBlockedAttempts: doc.controlledBlockedAttempts + 1
          };
          await saveQualificationDoc(doc);
          await logEval(
            "REJECTED",
            "RISK_MULTIPLIER_INVALID",
            ["RISK_MULTIPLIER_INVALID"],
            candidate.passed
          );
          return { handled: true, message: "lots_invalid:RISK_MULTIPLIER_INVALID" };
        }
      } else {
        // STRICT: legacy base-risk when multiplier unavailable.
        effectiveRisk =
          isValidDemoRiskMultiplier(riskMult)
            ? applyRiskMultiplier(settings.fixedRiskAmount, riskMult)
            : settings.fixedRiskAmount;
      }
      const xauSizing = calculatePepperstoneXauUsdDemoVolume({
        riskAmountDeposit: effectiveRisk,
        entryPrice: entryPx,
        stopLoss,
        quoteToDepositRate,
        ozPerLot: unitMapping.ozPerLot,
        minLots: symbol.minVolume,
        stepLots: symbol.volumeStep,
        maxLots: symbol.maxVolume,
        // ACTIVE_DEMO: do not fail on ProtoOATrader lacking freeMargin.
        // Authoritative freeMargin + ProtoOAExpectedMarginReq run after final volume.
        freeMargin: diagnostics.account?.freeMargin ?? null,
        leverage:
          diagnostics.account?.leverage ?? connection.leverage ?? null,
        remainingDailyLossCapacity,
        maxPositionExposureLots: settings.maxPositionExposureLots,
        sizingMode: settings.sizingMode,
        manualLotSize: settings.manualLotSize,
        deferBrokerMarginGate: oppCfg.mode === "ACTIVE_DEMO"
      });

      if (!xauSizing.ok || xauSizing.volumeLots == null || xauSizing.volumeLots <= 0) {
        const reason = xauSizing.rejectionReason ?? "LOTS_INVALID";
        doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
        await saveQualificationDoc(doc);
        logger.info("AutoTrade XAUUSD Demo sizing rejected", {
          uid,
          signalId,
          reason,
          notes: xauSizing.notes
        });
        await logEval("REJECTED", reason, [reason], candidate.passed);
        return { handled: true, message: `lots_invalid:${reason}` };
      }
      sizedLots = xauSizing.volumeLots;

      // Authoritative margin: refresh snapshot + ExpectedMargin for FINAL volume.
      if (oppCfg.mode === "ACTIVE_DEMO") {
        const protocolVolume =
          xauSizing.protocolVolume ?? lotsToOrderVolumeUnits(sizedLots);
        const symbolId = symbol.symbolId ?? connection.symbolId;
        if (!symbolId) {
          doc = {
            ...doc,
            controlledBlockedAttempts: doc.controlledBlockedAttempts + 1
          };
          await saveQualificationDoc(doc);
          await logEval(
            "REJECTED",
            "MARGIN_UNAVAILABLE",
            ["MARGIN_UNAVAILABLE"],
            candidate.passed
          );
          return { handled: true, message: "lots_invalid:MARGIN_UNAVAILABLE" };
        }
        const marginGate = await assertDemoAuthoritativeMarginGate({
          ownerUid: uid,
          side: direction as "BUY" | "SELL",
          protocolVolume,
          symbolId: String(symbolId)
        });
        if (!marginGate.ok) {
          doc = {
            ...doc,
            controlledBlockedAttempts: doc.controlledBlockedAttempts + 1
          };
          await saveQualificationDoc(doc);
          logger.info("AutoTrade authoritative margin gate rejected", {
            uid,
            signalId,
            reason: marginGate.reason,
            notes: marginGate.notes,
            protocolVolume,
            marginAgeMs: marginGate.marginAgeMs,
            freeMargin: marginGate.marginSnapshot?.freeMargin ?? null,
            expectedMargin: marginGate.expectedMargin
          });
          await logEval(
            "REJECTED",
            marginGate.reason,
            [marginGate.reason],
            candidate.passed,
            { brokerSubmissionAttempted: false }
          );
          return { handled: true, message: `lots_invalid:${marginGate.reason}` };
        }
        logger.info("AutoTrade authoritative margin gate passed", {
          uid,
          signalId,
          protocolVolume,
          freeMargin: marginGate.freeMargin,
          expectedMargin: marginGate.expectedMargin,
          marginSource: marginGate.marginSource,
          marginAgeMs: marginGate.marginAgeMs,
          openPositionCount: marginGate.marginSnapshot.openPositionCount
        });
      }
    } else if (oppCfg.mode === "ACTIVE_DEMO") {
      // ACTIVE_DEMO is Pepperstone Demo XAUUSD — never fall back to full-risk
      // generic sizing when the proven unit mapping is missing/unproven.
      doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
      await saveQualificationDoc(doc);
      await logEval(
        "REJECTED",
        "BROKER_UNIT_MAPPING_REQUIRED",
        ["BROKER_UNIT_MAPPING_REQUIRED"],
        candidate.passed
      );
      return {
        handled: true,
        message: "lots_invalid:BROKER_UNIT_MAPPING_REQUIRED"
      };
    } else {
      // STRICT / non-target broker path — legacy generic sizing.
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
        return { handled: true, message: sizingRejectMessage };
      }
      sizedLots = sizing.volume;
    }

    if (sizedLots == null || !(sizedLots > 0)) {
      doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
      await saveQualificationDoc(doc);
      return { handled: true, message: sizingRejectMessage };
    }

    // Final broker-submission authority gate (same SSOT as API/UI).
    // CONTROLLED_DEMO_QUALIFICATION: explicit ladder permission (intent not required).
    // DEMO_AUTO_ENABLED / LIVE_QUALIFICATION: full autonomous Demo Auto authority
    // including owner intent — CONTROLLED must not bypass intent OFF.
    if (state === "CONTROLLED_DEMO_QUALIFICATION") {
      const connection = await getConnection(uid);
      const controlledAuth = evaluateControlledDemoOrderAuthority({
        qualificationState: state,
        autoTradePaused: settings.autoTradePaused,
        emergencyStopActive: settings.emergencyStopActive,
        selectedAccountIsLive: Boolean(connection?.selectedAccountIsLive),
        demoAccountSelected: Boolean(
          connection?.selectedAccountId && !connection.selectedAccountIsLive
        ),
        tradingScope: connection?.oauthScope ?? null,
        demoOrderSubmissionEnabled: isCTraderDemoOrderSubmissionEnabled()
      });
      if (!controlledAuth.allowed) {
        await logEval(
          "REJECTED",
          "EXECUTION_AUTHORITY_OFF",
          controlledAuth.reasons,
          candidate.passed,
          {
            brokerSubmissionAttempted: false,
            executionAuthority: "CONTROLLED_OFF"
          }
        );
        return { handled: true, message: "execution_authority_off" };
      }
    } else {
      const demoAuthority = await resolveDemoAutoAuthorityForUser(uid);
      const gate = assertAutonomousDemoSubmissionAllowed(demoAuthority);
      if (!gate.ok) {
        await logEval(
          "REJECTED",
          gate.reasonCode,
          gate.reasons,
          candidate.passed,
          {
            brokerSubmissionAttempted: false,
            executionAuthority: "OFF"
          }
        );
        return { handled: true, message: "execution_authority_off" };
      }
    }

    const correlationId = newId("corr");
    try {
      const profitLockActive = isDemoProfitLockLadderEnabled(settings);
      const brokerOrderTakeProfit =
        profitLockActive && tp3 != null && Number.isFinite(tp3)
          ? tp3
          : takeProfit;
      if (profitLockActive && (tp3 == null || !Number.isFinite(tp3))) {
        logger.info(
          "demoProfitLockLadderEnabled but TP3 unavailable — preserving existing broker TP1 fail-closed path",
          { uid, signalId, decisionId }
        );
      }
      const result = await submitDemoMarketOrder({
        ownerUid: uid,
        side: direction as "BUY" | "SELL",
        lots: sizedLots,
        stopLoss,
        takeProfit: brokerOrderTakeProfit,
        entryHint: entryPx,
        comment: `GMQ ${correlationId}`,
        label: correlationId.slice(0, 30)
      });

      if (!result.accepted) {
        doc = { ...doc, controlledBlockedAttempts: doc.controlledBlockedAttempts + 1 };
        await saveQualificationDoc(doc);
        logger.info("AutoTrade order rejected", { uid, signalId, direction });
        return { handled: true, message: "order_rejected" };
      }

      if (armedTrade) {
        await saveArmedCandidate(
          markExecutionAttempted(armedTrade, new Date().toISOString())
        ).catch(() => undefined);
        await clearArmedCandidate(uid).catch(() => undefined);
      } else {
        await clearArmedCandidate(uid).catch(() => undefined);
      }
      logger.info("AutoTrade order submitted", {
        uid,
        signalId,
        direction,
        armedCandidateId: armedTrade?.candidateId ?? null
      });

      const openedAt = new Date().toISOString();
      const connSnap = await getConnection(uid).catch(() => null);
      const ctidTraderAccountId =
        result.ctidTraderAccountId ??
        connSnap?.selectedAccountId ??
        setup.accountId ??
        null;
      const traderLogin = connSnap?.selectedTraderLogin ?? null;
      const fillPrice = result.fillPrice ?? null;
      const brokerStopLoss = result.stopLoss ?? null;
      const brokerTakeProfit = result.takeProfit ?? null;
      const filledVolumeLots = result.filledVolumeLots ?? sizedLots;
      // Prefer broker fill/SL/TP for lifecycle authority; keep decision geometry as fallback.
      const lifecycleEntry = fillPrice ?? entryPx;
      const lifecycleSl = brokerStopLoss ?? stopLoss;
      const lifecycleTp = brokerTakeProfit ?? takeProfit;

      const trade: ControlledDemoTradeRecord = {
        id: newId("tr"),
        correlationId,
        signalId,
        at: openedAt,
        closedAt: null,
        direction: direction as "BUY" | "SELL",
        entry: lifecycleEntry,
        stopLoss: lifecycleSl,
        takeProfit: lifecycleTp,
        lots: filledVolumeLots,
        brokerOrderId: result.orderId ?? null,
        brokerPositionId: result.positionId ?? null,
        ctidTraderAccountId,
        traderLogin,
        symbol: "XAUUSD",
        requestedVolumeLots: sizedLots,
        filledVolumeLots,
        requestedEntry: entryPx,
        fillPrice,
        brokerStopLoss,
        brokerTakeProfit,
        openTimestamp: openedAt,
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
              counted: false,
              brokerOrderId: trade.brokerOrderId,
              brokerPositionId: trade.brokerPositionId,
              ctidTraderAccountId: trade.ctidTraderAccountId,
              traderLogin: trade.traderLogin,
              symbol: trade.symbol,
              requestedVolumeLots: trade.requestedVolumeLots,
              filledVolumeLots: trade.filledVolumeLots,
              requestedEntry: trade.requestedEntry,
              fillPrice: trade.fillPrice,
              brokerStopLoss: trade.brokerStopLoss,
              brokerTakeProfit: trade.brokerTakeProfit,
              openTimestamp: trade.openTimestamp,
              entry: trade.entry,
              stopLoss: trade.stopLoss,
              takeProfit: trade.takeProfit,
              lots: trade.lots
            }
          ],
          firstDemoAutoTradeAt: doc.firstDemoAutoTradeAt ?? trade.at
        };
        doc = recountDemoAuto(doc);
      }
      await saveQualificationDoc(doc);
      try {
        await markTradeOpened({ uid, environment: "demo", tradeId: trade.correlationId });
      } catch {
        /* daily counter best-effort */
      }
      const confirmMethod =
        armedTrade?.lastReasonCode === "FAST_CONFIRMATION_RECEIVED"
          ? "FAST_CONFIRMATION"
          : armedTrade
            ? "ARMED_5M_CONFIRMATION"
            : "DIRECT";
      const submitLabel = formatOpportunityActivity({
        tier: setupTier,
        direction: trade.direction,
        score: d.setupScore ?? d.confidence ?? null,
        event:
          confirmMethod === "FAST_CONFIRMATION"
            ? "FAST_CONFIRMATION_SUBMITTED"
            : "CONFIRMED_SUBMITTED"
      });
      try {
        await appendEvaluation({
          uid,
          accountMasked: setup.accountMasked,
          at: new Date().toISOString(),
          tradingDay: tradingDayKey(),
          stage: state,
          direction: trade.direction,
          signalId,
          decisionId,
          confidence: d.setupScore ?? tradeConfidence,
          entry: trade.entry,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          riskReward,
          spread: quote?.spread ?? null,
          maxSpread: settings.maxSpread,
          outcome: "QUALIFIED",
          reasonCode: "BROKER_SUBMITTED",
          reasonLabel: submitLabel,
          passed: [...candidate.passed, "ORDER_ACCEPTED"],
          failed: [],
          pipeline: {
            confirmation: confirmationState,
            session: sessionBucket,
            news: news.active ? "NEWS_GUARD" : "PASS",
            quoteAge:
              quoteAgeSeconds != null ? `${quoteAgeSeconds.toFixed(1)}s` : null,
            dailyLimits: null,
            openPositions: null,
            armedCandidate: armedTrade ? "ARMED" : null,
            executionAuthority: "ON",
            brokerSubmissionAttempted: true,
            brokerOrderIdMasked: trade.brokerOrderId
              ? `${String(trade.brokerOrderId).slice(0, 2)}…${String(trade.brokerOrderId).slice(-2)}`
              : null
          },
          finalReason: submitLabel
        });
      } catch {
        /* never block on log failure */
      }
      try {
        const riskMultJournal = demoRiskMultiplier({
          tier: setupTier,
          session: sessionBucket,
          config: oppCfg
        });
        const signalToEntryMs = armedTrade?.armedAt
          ? Date.now() - Date.parse(armedTrade.armedAt)
          : null;
        await createAutoTradeJournalEntry({
          uid,
          environment: "DEMO",
          source:
            state === "CONTROLLED_DEMO_QUALIFICATION"
              ? "qualification_controlled"
              : "demo_auto",
          direction: trade.direction,
          entry: trade.entry,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          lots: trade.lots,
          cashRisk:
            oppCfg.mode === "ACTIVE_DEMO" &&
            isValidDemoRiskMultiplier(riskMultJournal)
              ? applyRiskMultiplier(settings.fixedRiskAmount, riskMultJournal)
              : settings.fixedRiskAmount,
          confidence: d.confidence ?? null,
          riskReward,
          session: sessionBucket,
          spread: quote?.spread ?? null,
          pnl: null,
          reasonForTrade: [
            submitLabel,
            `Tier ${setupTier} (setup score — not win probability)`,
            d.setupScore != null ? `Setup score ${Math.round(d.setupScore)}/100` : null,
            d.confidence != null ? `Confidence ${Math.round(d.confidence)}` : null,
            riskReward != null ? `R:R ${riskReward.toFixed(2)}` : null,
            `Risk mult ${riskMultJournal}`,
            `Confirm ${confirmMethod}`,
            signalToEntryMs != null
              ? `Signal→entry ${Math.round(signalToEntryMs / 1000)}s`
              : null,
            "Server safety gates passed"
          ]
            .filter(Boolean)
            .join(" · "),
          reasonForExit: null,
          qualificationStage: state,
          accountMasked: setup.accountMasked,
          broker: "Pepperstone cTrader",
          correlationId: trade.correlationId,
          openedAt: trade.at,
          closedAt: null
        });
      } catch {
        /* journal must not block */
      }
      try {
        await createDemoPositionLifecycle({
          uid,
          correlationId: trade.correlationId,
          brokerOrderId: trade.brokerOrderId,
          brokerPositionId: trade.brokerPositionId,
          accountId: ctidTraderAccountId,
          accountMasked: setup.accountMasked,
          side: trade.direction,
          entry: lifecycleEntry,
          stopLoss: lifecycleSl,
          takeProfit: lifecycleTp,
          tp1: brokerTakeProfit ?? tp1,
          tp2,
          tp3,
          lots: filledVolumeLots,
          qualificationStage: state,
          decisionId: signalId,
          source:
            state === "CONTROLLED_DEMO_QUALIFICATION"
              ? "qualification_controlled"
              : "demo_auto",
          openedAt: trade.at
        });
      } catch (lifeErr) {
        logger.error("AutoTrade demo position lifecycle create failed", {
          uid,
          correlationId: trade.correlationId,
          error: lifeErr instanceof Error ? lifeErr.message : "unknown"
        });
      }
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
  grossPnl?: number | null;
  commission?: number | null;
  swap?: number | null;
  closePrice?: number | null;
  closeReason?: string | null;
  brokerDealId?: string | null;
  brokerPositionId?: string | null;
  brokerOrderId?: string | null;
  closedAt?: string | null;
}): Promise<QualificationPublicView> {
  const setup = await loadSetupSnapshot(args.uid);
  if (!setup.accountId) throw Object.assign(new Error("NO_ACCOUNT"), { code: "NO_ACCOUNT" });
  let doc = await getQualificationDoc(args.uid, setup.accountId);
  if (!doc) throw Object.assign(new Error("QUALIFICATION_NOT_STARTED"), { code: "QUALIFICATION_NOT_STARTED" });

  const now = args.closedAt ?? new Date().toISOString();
  const confirmedPnl = typeof args.pnl === "number" ? args.pnl : null;
  // Do not complete qualification closure without a real P/L (never invent 0).
  if (confirmedPnl == null) {
    return getQualificationView(args.uid);
  }

  const needsCloseAccounting = (t: {
    correlationId: string;
    status: string;
    counted: boolean;
    pnl: number | null;
  }) =>
    t.correlationId === args.correlationId &&
    (t.status !== "CLOSED" || !t.counted || t.pnl == null);

  const patchClose = <T extends ControlledDemoTradeRecord | DemoAutoTradeRecord>(
    t: T
  ): T => {
    if (!needsCloseAccounting(t)) return t;
    return {
      ...t,
      status: "CLOSED" as const,
      closedAt: t.closedAt ?? now,
      pnl: confirmedPnl,
      counted: true,
      brokerPositionId:
        args.brokerPositionId ??
        (t as { brokerPositionId?: string | null }).brokerPositionId ??
        null,
      brokerOrderId:
        args.brokerOrderId ??
        (t as { brokerOrderId?: string | null }).brokerOrderId ??
        null,
      grossPnl: args.grossPnl ?? (t as { grossPnl?: number | null }).grossPnl ?? null,
      commission:
        args.commission ?? (t as { commission?: number | null }).commission ?? null,
      swap: args.swap ?? (t as { swap?: number | null }).swap ?? null,
      netPnl: confirmedPnl,
      closePrice:
        args.closePrice ?? (t as { closePrice?: number | null }).closePrice ?? null,
      closeReason:
        args.closeReason ??
        (t as { closeReason?: string | null }).closeReason ??
        "BROKER_CLOSE",
      brokerDealId:
        args.brokerDealId ??
        (t as { brokerDealId?: string | null }).brokerDealId ??
        null
    };
  };

  const prior =
    doc.controlledTrades.find((t) => t.correlationId === args.correlationId) ||
    doc.demoAutoTrades.find((t) => t.correlationId === args.correlationId);
  const alreadyFullyCounted =
    prior != null &&
    prior.status === "CLOSED" &&
    prior.counted &&
    prior.pnl != null;

  doc = {
    ...doc,
    controlledTrades: doc.controlledTrades.map((t) => patchClose(t)),
    demoAutoTrades: doc.demoAutoTrades.map((t) => patchClose(t))
  };
  doc = recountControlled(doc);
  doc = recountDemoAuto(doc);
  const advanced = deriveAdvancedState(doc);
  if (advanced !== doc.state && doc.state !== "PAUSED" && doc.state !== "BLOCKED") {
    doc = await appendTransition(doc, advanced, "trade_closed", buildSha());
  }
  await saveQualificationDoc(doc);
  const closed =
    doc.controlledTrades.find((t) => t.correlationId === args.correlationId) ||
    doc.demoAutoTrades.find((t) => t.correlationId === args.correlationId);
  if (closed && closed.status === "CLOSED") {
    // markTradeClosed is idempotent via countedTradeIds — safe on repair.
    if (!alreadyFullyCounted || prior?.pnl == null) {
      try {
        await markTradeClosed({
          uid: args.uid,
          environment: "demo",
          tradeId: args.correlationId,
          pnl: confirmedPnl
        });
      } catch {
        /* ignore */
      }
    }
    try {
      const updated = await updateAutoTradeJournalOnClose({
        uid: args.uid,
        correlationId: args.correlationId,
        pnl: confirmedPnl,
        closedAt: closed.closedAt ?? now,
        reasonForExit: args.closeReason ?? "Position closed",
        exitPrice: args.closePrice ?? null,
        managementActions: [],
        durationSeconds: null,
        slTpOutcome: null,
        brokerPnlConfirmed: true,
        brokerDealId: args.brokerDealId ?? null,
        grossPnl: args.grossPnl ?? null,
        commission: args.commission ?? null,
        swap: args.swap ?? null
      });
      if (!updated.updated) {
        await createAutoTradeJournalEntry({
          uid: args.uid,
          environment: "DEMO",
          source: "qualification_controlled",
          direction: (closed as { direction?: "BUY" | "SELL" }).direction ?? "BUY",
          entry: (closed as { entry?: number | null }).entry ?? null,
          stopLoss: (closed as { stopLoss?: number | null }).stopLoss ?? null,
          takeProfit: (closed as { takeProfit?: number | null }).takeProfit ?? null,
          lots: (closed as { lots?: number | null }).lots ?? null,
          cashRisk: null,
          confidence: null,
          riskReward: null,
          session: null,
          spread: null,
          pnl: confirmedPnl,
          reasonForTrade: "Controlled Demo / Demo Auto trade",
          reasonForExit: args.closeReason ?? "Position closed",
          qualificationStage: advanced,
          accountMasked: setup.accountMasked,
          broker: "Pepperstone cTrader",
          correlationId: args.correlationId,
          openedAt: closed.at,
          closedAt: closed.closedAt,
          brokerPnlConfirmed: true
        });
      }
    } catch {
      /* ignore */
    }
  }
  return getQualificationView(args.uid);
}

export { allowsDemoOrderSubmission, QUALIFICATION_GATES };
export type { QualificationState, QualificationPublicView };
