/**
 * Assemble Gold Hunter Admin status payload for Dashboard / Monitor / Control.
 * Truthful: does not invent quotes or broker money fields.
 * Selector readiness is runtime — not a static true switch.
 */

import { getSharedXauusdQuote } from "../marketFeed/sharedMarketData";
import {
  evaluateGoldHunterArmingReadiness,
  fetchGoldHunterAccountSnapshot,
  type GoldHunterAccountSnapshot
} from "./accountSnapshot";
import { computeGoldHunterCommittedCapital } from "./committedCapital";
import { loadGoldHunterConfig, listGoldHunterAudit } from "./configStore";
import { evaluateGoldHunterOrderGates } from "./orderGates";
import { isGoldHunterProtectionGeometryConnected } from "./protectionGeometry";
import {
  plannedDailyLossBudgetEur,
  plannedRiskBudgetEur
} from "./riskSizing";
import { loadGoldHunterSelectorRuntime } from "./selectorRuntimeStore";
import {
  getGoldHunterStrategySelector,
  type GoldHunterSelectedCandidate
} from "./strategySelector";
import { getGoldHunterOpenPositionDiagnostics } from "./demoPositionManager";
import {
  computeDemoPerformance,
  listGoldHunterDemoTrades,
  todayNetPnlEur
} from "./tradeStore";
import {
  GH_ADMIN_EXECUTION_MODE,
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "./types";
import { isGoldHunterSignalDurablyConsumed } from "./signalClaimStore";
import { loadGoldHunterExecutionDiagnostics } from "./executionRuntimeStore";
import {
  GOLD_HUNTER_BRAIN_VERSION,
  GOLD_HUNTER_SOFTWARE_REVISION,
  GOLD_HUNTER_SOFTWARE_REVISION_AT,
  GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION,
  GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION
} from "./abc/versions";

const FEED_STALE_MS = 45_000;
const FEED_HARD_STALE_MS = 120_000;

export type GoldHunterStatusPayload = {
  product: "GOLD_HUNTER";
  strategy: typeof GH_ADMIN_STRATEGY_ID;
  executionMode: typeof GH_ADMIN_EXECUTION_MODE;
  liveExecutionEnabled: false;
  runtimeSha: string | null;
  config: Awaited<ReturnType<typeof loadGoldHunterConfig>>;
  modeLabel: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  market: {
    symbol: "XAUUSD";
    bid: number | null;
    ask: number | null;
    mid: number | null;
    spread: number | null;
    marketStatus: string;
    freshness: string;
    ageMs: number | null;
    feedState: "LIVE" | "STALE" | "HARD_STALE" | "UNAVAILABLE";
    updatedAt: string | null;
  };
  broker: {
    provider: "cTrader";
    connected: boolean;
    environment: "DEMO" | "LIVE" | null;
    authState: GoldHunterAccountSnapshot["authState"];
    authorised: boolean;
    accountMasked: string | null;
    brokerName: string | null;
    balance: number | null;
    currency: string | null;
    equity: number | null;
    marginUsed: number | null;
    freeMargin: number | null;
    openPositionCount: number | null;
    snapshotAgeMs: number | null;
    lastSyncAt: string | null;
    snapshotSource: GoldHunterAccountSnapshot["source"];
    demoOrderSubmissionEnabled: boolean;
    validForRisk: boolean;
  };
  capital: {
    allocatedEur: number;
    committedEur: number | null;
    availableEur: number | null;
    todayPnlEur: number;
    riskBudgetEur: number;
    dailyLossBudgetEur: number;
    committedKnown: boolean;
  };
  health: {
    marketFeed: "LIVE" | "STALE" | "HARD_STALE" | "UNAVAILABLE";
    transport: "CONNECTED" | "DISCONNECTED";
    depth: "VALID" | "STALE" | "CROSSED" | "RECOVERY" | "UNKNOWN" | "UNAVAILABLE";
    strategy: "READY" | "WAITING" | "PAUSED" | "WAITING_FOR_MARKET";
    risk: "NORMAL" | "LIMITED" | "HALTED";
    autoTrade: "ACTIVE" | "OFF" | "PAUSED";
  };
  strategyPipeline: {
    connected: boolean;
    spot: "LIVE" | "STALE" | "HARD_STALE" | "UNAVAILABLE" | "CLOSED";
    depth: string;
    selector: "CONNECTED" | "NOT_CONNECTED";
    state: string;
    lastSelectedCandidate: GoldHunterSelectedCandidate | null;
    lastObservationAt: string | null;
    normalizationVersion: string | null;
    protectionGeometryConnected: boolean;
  };
  arming: {
    ready: boolean;
    blockers: string[];
    strategySelectorConnected: boolean;
  };
  gates: ReturnType<typeof evaluateGoldHunterOrderGates>;
  openTrades: GoldHunterDemoTrade[];
  /** In-memory SMART_POSITION_MANAGER_V1 diagnostics for open trades. */
  openPositionManagement: Array<{
    tradeId: string;
    brainVersion: string;
    positionManagerVersion: string;
    profitManagementState: string;
    currentR: number;
    mfeR: number;
    mfeEur: number | null;
    maeR: number;
    protectedProfitR: number;
    executableProtectedProfitR: number;
    protectedStopPrice: number | null;
    lastStopAdjustReason: string | null;
    lastHarvestAssessment: unknown;
  }>;
  unmatchedDemoPositions: Array<{
    label: "UNMATCHED DEMO POSITION";
    brokerPositionId: string;
    note: string;
  }>;
  performanceToday: ReturnType<typeof computeDemoPerformance>;
  audit: Awaited<ReturnType<typeof listGoldHunterAudit>>;
  signal: {
    present: boolean;
    setup: "A" | "B" | "C" | null;
    side: "BUY" | "SELL" | null;
    signalId: string | null;
    quality: number | null;
    signalTimestamp: string | null;
    depthValidity: string | null;
    consumed: boolean;
    ageMs: number | null;
    note: string;
  };
  strategyVersions: {
    brainVersion: string;
    softwareRevision: string;
    softwareRevisionAt: string;
    positionManagerVersion: string;
    lossControllerVersion: string;
    rollingRealisedR: number;
    rollingSampleCount: number;
    lossCircuitBreakerActive: boolean;
    circuitBreakerReason: string | null;
    lossStreakGuardActive: boolean;
    consecutiveLosses: number;
    unknownRealisedRLossCount: number;
    rollingUnknownRTradeCount: number;
    lastUnknownRTradeId: string | null;
    lastUnknownRReason: string | null;
    consecutiveUnknownRLosses: number;
    unknownRGuardActive: boolean;
    entryIntegrityHealthy: boolean;
    entryIntegrityRecoveredAtMs: number | null;
    lastEntryIntegrityRecoveryReason: string | null;
    lastClosedTradeId: string | null;
    updatedAt: string | null;
    workerRevision: string | null;
    telemetrySource: "QUOTE_WORKER" | "API_PROCESS_FALLBACK" | null;
    telemetryAgeMs: number | null;
    reentryState: GoldHunterSelectedCandidate["antiChurnState"] | null;
    bReentryState: GoldHunterSelectedCandidate["bReentryState"] | null;
  };
  execution: Awaited<ReturnType<typeof loadGoldHunterExecutionDiagnostics>>;
};

function feedStateFromAge(
  ageMs: number | null,
  freshness: string,
  marketStatus: string
): "LIVE" | "STALE" | "HARD_STALE" | "UNAVAILABLE" {
  if (freshness === "UNAVAILABLE" || ageMs == null) return "UNAVAILABLE";
  if (marketStatus === "CLOSED") {
    if (ageMs > FEED_HARD_STALE_MS) return "HARD_STALE";
    if (ageMs > FEED_STALE_MS) return "STALE";
    return "STALE";
  }
  if (ageMs > FEED_HARD_STALE_MS) return "HARD_STALE";
  if (ageMs > FEED_STALE_MS || freshness === "STALE") return "STALE";
  return "LIVE";
}

function depthHealthFromValidity(
  validity: string | null | undefined,
  marketStatus: string
): GoldHunterStatusPayload["health"]["depth"] {
  if (marketStatus === "CLOSED") return "UNAVAILABLE";
  switch (validity) {
    case "DEPTH_VALID":
      return "VALID";
    case "DEPTH_STALE":
      return "STALE";
    case "DEPTH_CROSSED":
      return "CROSSED";
    case "RESYNC_RECOVERY":
      return "RECOVERY";
    case "DEPTH_UNAVAILABLE":
      return "UNAVAILABLE";
    default:
      return "UNKNOWN";
  }
}

export async function assembleGoldHunterStatus(
  ownerUid: string,
  isAdmin: boolean,
  opts?: { forceAccountRefresh?: boolean }
): Promise<GoldHunterStatusPayload> {
  const config = await loadGoldHunterConfig(ownerUid);
  const trades = await listGoldHunterDemoTrades(ownerUid, { limit: 200 });
  const openTrades = trades.filter(
    (t) =>
      t.status !== "CLOSED" &&
      t.status !== "BROKER_REJECTED" &&
      t.status !== "BROKER_SUBMIT_ERROR" &&
      (t.result === "OPEN" || t.result == null) &&
      (t.status === "FILLED" ||
        t.status === "PROTECTED" ||
        t.status === "ACCEPTED_PENDING_FILL" ||
        t.status === "PENDING_RECONCILIATION" ||
        t.status === "CLOSE_REQUESTED" ||
        t.status === "CLOSE_ACCEPTED_PENDING_SETTLEMENT" ||
        t.status === "SENT" ||
        t.status === "ORDER_CREATED")
  );
  const audit = await listGoldHunterAudit(ownerUid, 20);

  let marketQuote: Awaited<ReturnType<typeof getSharedXauusdQuote>> | null = null;
  try {
    marketQuote = await getSharedXauusdQuote({ refreshIfNeeded: true });
  } catch {
    marketQuote = null;
  }

  const q = marketQuote?.quote ?? null;
  const ageMs = q?.ageMs ?? null;
  const marketStatus = q?.marketStatus ?? marketQuote?.marketStatus ?? "UNKNOWN";
  const feedState = feedStateFromAge(
    ageMs,
    marketQuote?.freshness ?? "UNAVAILABLE",
    marketStatus
  );

  const account = await fetchGoldHunterAccountSnapshot({
    ownerUid,
    forceRefresh: opts?.forceAccountRefresh === true
  });

  const brokerConnected =
    account.authState === "AUTHORISED" ||
    account.authState === "STALE" ||
    account.authState === "CONNECTED";
  const brokerEnvironment = account.environment;

  const todayPnl = todayNetPnlEur(trades);
  const dailyLossBudget = plannedDailyLossBudgetEur(config);
  const riskBudget = plannedRiskBudgetEur(config);
  const committed = computeGoldHunterCommittedCapital({
    config,
    openTrades,
    brokerUsedMarginEur: account.marginUsed
  });

  const runtime =
    (await loadGoldHunterSelectorRuntime(ownerUid)) ??
    (() => {
      const sel = getGoldHunterStrategySelector(ownerUid);
      return {
        ownerUid,
        readiness: sel.readiness(),
        lastCandidate: sel.getLastCandidate(),
        lastObservationAt: sel.getLastObservationAt(),
        depthValidity: sel.getLastSnapshot()?.depthValidity ?? null,
        spotAgeMs: null as number | null,
        depthAgeMs: null as number | null,
        normalizationVersion: "CTRADER_NORMALIZED_V1" as const,
        updatedAt: new Date().toISOString(),
        protectionGeometryConnected: isGoldHunterProtectionGeometryConnected(),
        lossControllerTelemetry: null
      };
    })();

  const selectorConnected = runtime.readiness.connected === true;
  const lastCandidate = runtime.lastCandidate;
  const depthHealth = depthHealthFromValidity(
    lastCandidate?.depthValidity ?? runtime.depthValidity,
    marketStatus
  );

  const marketOpen = marketStatus === "OPEN";
  const feedFresh = feedState === "LIVE";
  const depthValid =
    depthHealth === "VALID" &&
    (lastCandidate == null || lastCandidate.depthExecutable);

  const signalPresent = Boolean(
    lastCandidate &&
      lastCandidate.depthExecutable &&
      !lastCandidate.consumed
  );
  let signalConsumed = lastCandidate?.consumed === true;
  if (lastCandidate && !signalConsumed) {
    signalConsumed = await isGoldHunterSignalDurablyConsumed(
      ownerUid,
      lastCandidate.signalId
    );
  }

  const spreadOk =
    lastCandidate != null
      ? lastCandidate.spread <= 0.35
      : q != null && Number.isFinite(q.spread)
        ? q.spread <= 1.5
        : false;
  const capitalOk =
    committed.known &&
    committed.availableEur != null &&
    committed.availableEur > 0 &&
    config.allocatedCapitalEur > 0;
  const dailyLossOk = todayPnl > -dailyLossBudget;

  const gates = evaluateGoldHunterOrderGates({
    config,
    brokerEnvironment,
    brokerConnected,
    accountSnapshotValid: account.validForRisk,
    marketOpen,
    feedFresh,
    depthValid: signalPresent ? depthValid : depthValid || !signalPresent,
    spreadOk,
    capitalOk: capitalOk && committed.known,
    dailyLossOk,
    openTradeCount: openTrades.length,
    signalPresent,
    signalConsumed,
    isAdmin
  });

  const armCheck = evaluateGoldHunterArmingReadiness({
    snapshot: account,
    allocatedCapitalEur: config.allocatedCapitalEur,
    riskPerTradePct: config.riskPerTradePct,
    strategySelectorConnected: selectorConnected,
    protectionGeometryConnected: runtime.protectionGeometryConnected
  });
  const arming = {
    ready: armCheck.ok,
    blockers: armCheck.blockers,
    strategySelectorConnected: selectorConnected
  };

  let autoTradeHealth: GoldHunterStatusPayload["health"]["autoTrade"] = "OFF";
  if (config.emergencyStopActive || config.pauseNewEntries) autoTradeHealth = "PAUSED";
  else if (config.demoAutoTradeEnabled) autoTradeHealth = "ACTIVE";

  let riskHealth: GoldHunterStatusPayload["health"]["risk"] = "NORMAL";
  if (config.emergencyStopActive) riskHealth = "HALTED";
  else if (!dailyLossOk || !capitalOk || !account.validForRisk || !committed.known)
    riskHealth = "LIMITED";

  let strategyHealth: GoldHunterStatusPayload["health"]["strategy"] = "WAITING";
  if (config.pauseNewEntries || config.emergencyStopActive) strategyHealth = "PAUSED";
  else if (!marketOpen) strategyHealth = "WAITING_FOR_MARKET";
  else if (gates.ok) strategyHealth = "READY";

  const modeLabel =
    config.mode === "DEMO_AUTO" && config.demoAutoTradeEnabled
      ? {
          primary: "DEMO AUTOTRADE",
          secondary: "CTRADER DEMO",
          tertiary:
            account.authState === "AUTHORISED"
              ? "CONNECTED"
              : account.authState === "STALE"
                ? "STALE"
                : account.authState
        }
      : marketOpen
        ? {
            primary: "RESEARCH",
            secondary: "PAPER ONLY",
            tertiary: "NO BROKER EXECUTION"
          }
        : {
            primary: config.demoAutoTradeEnabled ? "DEMO AUTOTRADE" : "RESEARCH",
            secondary: "CTRADER DEMO",
            tertiary: marketOpen ? "READY" : "WAITING FOR MARKET"
          };

  const spotPipeline =
    marketStatus === "CLOSED"
      ? ("CLOSED" as const)
      : feedState === "LIVE"
        ? ("LIVE" as const)
        : feedState;

  const candidateAgeMs =
    lastCandidate?.signalTimestamp != null
      ? Date.now() - Date.parse(lastCandidate.signalTimestamp)
      : null;

  const selectorWaitReason =
    lastCandidate?.antiChurnState?.rejectionReason ??
    lastCandidate?.m1CandleFlow?.waitReason ??
    null;
  const lossTelemetry = runtime.lossControllerTelemetry;
  let signalNote = "WAIT — NO SETUP SELECTED";
  if (!selectorConnected) {
    signalNote =
      "WAIT — NO SETUP SELECTED (Gold Hunter A/B/C selector not connected — Demo AutoTrade remains fail-closed for natural entries)";
  } else if (!marketOpen) {
    signalNote = "WAIT — MARKET CLOSED";
  } else if (lossTelemetry?.unknownRGuardActive) {
    signalNote = "WAIT — WAIT_REALISED_R_INCOMPLETE";
  } else if (lossTelemetry?.lossCircuitBreakerActive) {
    signalNote = "WAIT — WAIT_LOSS_CIRCUIT_BREAKER";
  } else if (lossTelemetry?.lossStreakGuardActive) {
    signalNote = "WAIT — WAIT_LOSS_STREAK_GUARD";
  } else if (selectorWaitReason) {
    signalNote = `WAIT — ${selectorWaitReason}`;
  } else if (lastCandidate && !lastCandidate.depthExecutable) {
    signalNote = `WAIT — DEPTH INVALID (${lastCandidate.depthValidity})`;
  } else if (signalPresent) {
    signalNote = `SELECTED ${lastCandidate!.setup} ${lastCandidate!.side}`;
  }

  return {
    product: "GOLD_HUNTER",
    strategy: GH_ADMIN_STRATEGY_ID,
    executionMode: GH_ADMIN_EXECUTION_MODE,
    liveExecutionEnabled: false,
    runtimeSha: process.env.K_REVISION ?? process.env.GIT_COMMIT_SHA ?? null,
    config,
    modeLabel,
    market: {
      symbol: "XAUUSD",
      bid: q?.bid ?? lastCandidate?.bid ?? null,
      ask: q?.ask ?? lastCandidate?.ask ?? null,
      mid: q?.mid ?? lastCandidate?.mid ?? null,
      spread: q?.spread ?? lastCandidate?.spread ?? null,
      marketStatus,
      freshness: marketQuote?.freshness ?? "UNAVAILABLE",
      ageMs,
      feedState,
      updatedAt: marketQuote?.updatedAt ?? null
    },
    broker: {
      provider: "cTrader",
      connected: brokerConnected,
      environment: brokerEnvironment,
      authState: account.authState,
      authorised: account.authorised,
      accountMasked: account.accountMasked,
      brokerName: account.brokerName,
      balance: account.balance,
      currency: account.currency,
      equity: account.equity,
      marginUsed: account.marginUsed,
      freeMargin: account.freeMargin,
      openPositionCount: account.openPositionCount,
      snapshotAgeMs: account.ageMs,
      lastSyncAt: account.capturedAt,
      snapshotSource: account.source,
      demoOrderSubmissionEnabled: account.demoOrderSubmissionEnabled,
      validForRisk: account.validForRisk
    },
    capital: {
      allocatedEur: config.allocatedCapitalEur,
      committedEur: committed.committedEur,
      availableEur: committed.availableEur,
      todayPnlEur: todayPnl,
      riskBudgetEur: riskBudget,
      dailyLossBudgetEur: dailyLossBudget,
      committedKnown: committed.known
    },
    health: {
      marketFeed: feedState,
      transport: brokerConnected ? "CONNECTED" : "DISCONNECTED",
      depth: depthHealth,
      strategy: strategyHealth,
      risk: riskHealth,
      autoTrade: autoTradeHealth
    },
    strategyPipeline: {
      connected: selectorConnected,
      spot: spotPipeline,
      depth: depthHealth,
      selector: selectorConnected ? "CONNECTED" : "NOT_CONNECTED",
      state: !selectorConnected
        ? "SELECTOR_NOT_CONNECTED"
        : !marketOpen
          ? "WAITING_FOR_MARKET"
          : signalPresent
            ? "SELECTED"
            : "EVALUATING",
      lastSelectedCandidate: lastCandidate,
      lastObservationAt: runtime.lastObservationAt,
      normalizationVersion: runtime.normalizationVersion,
      protectionGeometryConnected: runtime.protectionGeometryConnected
    },
    arming,
    gates,
    openTrades,
    openPositionManagement: getGoldHunterOpenPositionDiagnostics(ownerUid),
    unmatchedDemoPositions: [],
    performanceToday: computeDemoPerformance(trades, "today"),
    audit,
    signal: {
      present: signalPresent,
      setup: lastCandidate?.setup ?? null,
      side: lastCandidate?.side ?? null,
      signalId: lastCandidate?.signalId ?? null,
      quality: lastCandidate?.quality ?? null,
      signalTimestamp: lastCandidate?.signalTimestamp ?? null,
      depthValidity: lastCandidate?.depthValidity ?? runtime.depthValidity,
      consumed: signalConsumed,
      ageMs: candidateAgeMs,
      note: signalNote
    },
    strategyVersions: {
      brainVersion: GOLD_HUNTER_BRAIN_VERSION,
      softwareRevision: GOLD_HUNTER_SOFTWARE_REVISION,
      softwareRevisionAt: GOLD_HUNTER_SOFTWARE_REVISION_AT,
      positionManagerVersion: GOLD_HUNTER_SMART_POSITION_MANAGER_VERSION,
      lossControllerVersion: GOLD_HUNTER_SMART_LOSS_CONTROLLER_VERSION,
      ...(() => {
        const tel = runtime.lossControllerTelemetry;
        const nowMs = Date.now();
        if (tel && tel.telemetrySource === "QUOTE_WORKER") {
          const updatedMs = Date.parse(tel.updatedAt);
          return {
            rollingRealisedR: tel.rollingRealisedR,
            rollingSampleCount: tel.rollingSampleCount,
            lossCircuitBreakerActive: tel.lossCircuitBreakerActive,
            circuitBreakerReason: tel.circuitBreakerReason,
            lossStreakGuardActive: tel.lossStreakGuardActive,
            consecutiveLosses: tel.consecutiveLosses,
            unknownRealisedRLossCount: tel.unknownRealisedRLossCount,
            rollingUnknownRTradeCount: tel.rollingUnknownRTradeCount,
            lastUnknownRTradeId: tel.lastUnknownRTradeId,
            lastUnknownRReason: tel.lastUnknownRReason,
            consecutiveUnknownRLosses: tel.consecutiveUnknownRLosses,
            unknownRGuardActive: tel.unknownRGuardActive,
            entryIntegrityHealthy: tel.entryIntegrityHealthy,
            entryIntegrityRecoveredAtMs: tel.entryIntegrityRecoveredAtMs,
            lastEntryIntegrityRecoveryReason:
              tel.lastEntryIntegrityRecoveryReason,
            lastClosedTradeId: tel.lastClosedTradeId,
            updatedAt: tel.updatedAt,
            workerRevision: tel.workerRevision,
            telemetrySource: "QUOTE_WORKER" as const,
            telemetryAgeMs: Number.isFinite(updatedMs)
              ? Math.max(0, nowMs - updatedMs)
              : null
          };
        }
        // Fallback only when worker telemetry missing — mark source clearly.
        try {
          const lc = getGoldHunterStrategySelector(ownerUid).getLossControllerEntryState();
          return {
            rollingRealisedR: lc.rollingRealisedR,
            rollingSampleCount: lc.rollingSampleCount,
            lossCircuitBreakerActive: lc.lossCircuitBreakerActive,
            circuitBreakerReason: lc.circuitBreakerReason,
            lossStreakGuardActive: lc.lossStreakGuardActive,
            consecutiveLosses: lc.consecutiveLosses,
            unknownRealisedRLossCount: lc.unknownRealisedRLossCount,
            rollingUnknownRTradeCount: lc.rollingUnknownRTradeCount,
            lastUnknownRTradeId: lc.lastUnknownRTradeId,
            lastUnknownRReason: lc.lastUnknownRReason,
            consecutiveUnknownRLosses: lc.consecutiveUnknownRLosses,
            unknownRGuardActive: lc.unknownRGuardActive,
            entryIntegrityHealthy: lc.entryIntegrityHealthy,
            entryIntegrityRecoveredAtMs: lc.entryIntegrityRecoveredAtMs,
            lastEntryIntegrityRecoveryReason:
              lc.lastEntryIntegrityRecoveryReason,
            lastClosedTradeId: lc.lastClosedTradeId,
            updatedAt: null as string | null,
            workerRevision: null as string | null,
            telemetrySource: "API_PROCESS_FALLBACK" as const,
            telemetryAgeMs: null as number | null
          };
        } catch {
          return {
            rollingRealisedR: 0,
            rollingSampleCount: 0,
            lossCircuitBreakerActive: false,
            circuitBreakerReason: null as string | null,
            lossStreakGuardActive: false,
            consecutiveLosses: 0,
            unknownRealisedRLossCount: 0,
            rollingUnknownRTradeCount: 0,
            lastUnknownRTradeId: null as string | null,
            lastUnknownRReason: null as string | null,
            consecutiveUnknownRLosses: 0,
            unknownRGuardActive: false,
            entryIntegrityHealthy: true,
            entryIntegrityRecoveredAtMs: null as number | null,
            lastEntryIntegrityRecoveryReason: null as string | null,
            lastClosedTradeId: null as string | null,
            updatedAt: null as string | null,
            workerRevision: null as string | null,
            telemetrySource: "API_PROCESS_FALLBACK" as const,
            telemetryAgeMs: null as number | null
          };
        }
      })(),
      reentryState: lastCandidate?.antiChurnState ?? null,
      bReentryState: lastCandidate?.bReentryState ?? null
    },
    execution: await (async () => {
      // Read-only hydrate from worker-persisted telemetry.
      // Never patch/persist from the API process — that would overwrite the
      // quote-worker execution truth with empty IDLE state.
      const diag = await loadGoldHunterExecutionDiagnostics(ownerUid);
      return {
        ...diag,
        autoTradeEnabled: config.demoAutoTradeEnabled
      };
    })()
  };
}
