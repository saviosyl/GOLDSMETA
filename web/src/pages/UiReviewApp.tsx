import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { AppShell } from "../components/layout/AppShell";
import { OverviewPage } from "./OverviewPage";
import { IntelligencePage } from "./IntelligencePage";
import { PremiumAnalyticsPage } from "./PremiumAnalyticsPage";
import { ReplayPage } from "./ReplayPage";
import { SettingsPage } from "./SettingsPage";
import { RiskPlannerPage } from "./RiskPlannerPage";
import { BrandConceptsPage } from "./BrandConceptsPage";
import { AutoTradePage } from "./AutoTradePage";
import type { AuthContextValue } from "../lib/auth";
import { ReviewAuthProvider } from "../lib/auth";
import { buildReviewAutoTradeStatus, type AutoTradeStatus } from "../lib/autoTradeTypes";
import { ApiError } from "../types/models";

/**
 * Preview-only UI review shell — no passwords or tokens.
 * Enabled only on localhost / *.pages.dev (and similar preview hosts).
 */
export function isUiReviewHost(hostname = window.location.hostname): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".pages.dev") ||
    hostname.includes("preview")
  );
}

function buildReviewApi() {
  const params = new URLSearchParams(window.location.search);
  const empty = params.get("empty") === "1";
  const offline = params.get("offline") === "1";
  const decisionOverride = (params.get("decision") || "WAIT").toUpperCase();
  const decisionCode =
    decisionOverride === "BUY" || decisionOverride === "SELL" ? decisionOverride : "WAIT";

  let autoTrade = buildReviewAutoTradeStatus();

  const decision = {
    schemaVersion: "3",
    decisionId: "review_dec_001",
    symbol: "XAUUSD",
    timeframe: "M15",
    barTime: "2026-07-21T21:30:00.000Z",
    generatedAt: "2026-07-21T21:45:00.000Z",
    marketDataTime: "2026-07-21T21:45:00.000Z",
    validUntil: "2026-07-21T22:45:00.000Z",
    decision: decisionCode,
    confidence: 42,
    confidenceLabel: "LOW",
    marketRegime: "RANGE",
    dataQuality: "GOOD",
    isProvisional: false,
    environment: "LIVE",
    setupScore: 42,
    entry: {},
    stopLoss: {},
    takeProfits: [],
    riskReward: {},
    bullishEvidence: [],
    bearishEvidence: [],
    reasonCodes: ["CONFIRMATION_INCOMPLETE"],
    reasonSummary: ["Waiting for confirmation"],
    warnings: [],
    missingInputs: [],
    invalidation: "—",
    disclaimer: "Analysis only",
    lifecycleState: "OPEN",
    ruleConfigVersion: "v3",
    backendVersion: "review",
    notificationSent: false,
    currentSession: "NEWYORK",
    lastKnownPrice: 2385.4,
    ohlcv: { open: 2382, high: 2391, low: 2376, close: 2385.4, volume: 1200 },
    marketStructure: { trend: "RANGE", poc: 2380, vah: 2390, val: 2370 }
  };

  const setup = {
    setupId: "review_setup_1",
    decisionId: decision.decisionId,
    symbol: "XAUUSD",
    timeframe: "M15",
    direction: "BUY" as const,
    environment: "LIVE" as const,
    isTestSetup: false,
    createdAt: "2026-07-21T20:00:00.000Z",
    barTime: "2026-07-21T20:00:00.000Z",
    session: "LONDON",
    levels: {
      entryPrice: 2384.2,
      entryType: "LIMIT",
      stopLoss: 2378.0,
      tp1: 2390,
      tp2: 2395,
      tp3: 2400
    },
    initialRisk: 6.2,
    expectedRR: { tp1: 1, tp2: 1.8, tp3: 2.5 },
    confidence: 55,
    status: "ACTIVE_SHADOW",
    statusHistory: [],
    entryTriggeredAt: null,
    resolvedAt: null,
    resolution: "OPEN",
    barsToEntry: null,
    barsToResolution: null,
    barsOpen: 4,
    excursion: {
      mfe: 0.4,
      mae: 0.2,
      highestPriceSeen: null,
      lowestPriceSeen: null
    },
    outcome: {
      rawResolution: "OPEN",
      rawRealisedR: null,
      modelledResolution: "OPEN",
      modelledRealisedR: null
    }
  };

  return {
    latestDecision: async () => (empty ? null : decision),
    listActiveSetups: async () => (empty ? [] : [setup]),
    listSetups: async () =>
      empty
        ? []
        : [
            setup,
            { ...setup, setupId: "review_setup_2" },
            { ...setup, setupId: "review_setup_3" }
          ],
    v5Briefing: async () =>
      empty
        ? { insufficientData: true }
        : {
            session: "NEWYORK",
            marketRegime: "RANGE",
            positionVsPoc: "ABOVE_POC",
            atrLabel: "NORMAL",
            atrValue: 12.4,
            levels: { poc: 2380, vah: 2390, val: 2370 },
            currentState: "WAIT",
            insufficientData: false,
            dataTimestamp: decision.generatedAt,
            disclaimer: "Informational only"
          },
    v5Score: async () =>
      empty
        ? null
        : {
            total: 61,
            components: [
              { label: "Trend", score: 12, max: 12, reason: "Directional context supports the current bias." },
              { label: "Market Structure", score: 2, max: 12, reason: "No clear invalidation structure." },
              { label: "Volume Profile", score: 12, max: 12, reason: "Price interacting with verified POC." },
              { label: "Risk Geometry", score: 0, max: 14, reason: "Not evaluated — no validated plan geometry yet." },
              { label: "ATR", score: 10, max: 10, reason: "Volatility within expected band." },
              { label: "Session", score: 5.6, max: 8, reason: "Acceptable session context." },
              { label: "Confirmation", score: 3.6, max: 12, reason: "Multi-bar confirmation incomplete." },
              { label: "Liquidity", score: 3.2, max: 8, reason: "Partial verified liquidity context." },
              { label: "Momentum", score: 7, max: 7, reason: "Momentum aligned with bias." },
              { label: "News", score: 0, max: 5, reason: "No verified calendar available." }
            ],
            disclaimer:
              "GoldMeta Score is a rules-based quality score, not the probability of profit."
          },
    v5Ask: async () => ({
      answer: offline
        ? "Offline — LIVE verification unavailable."
        : "Waiting because multi-bar confirmation is still incomplete.",
      verifiedFacts: ["Verified rejection: confirmation incomplete"],
      explanations: ["WAIT means gates did not pass"],
      insufficientData: false,
      disclaimer: "Verified vs Explanation",
      symbol: "XAUUSD",
      environment: "LIVE",
      mode: "SHADOW",
      freshness: offline ? "OFFLINE" : "VERIFIED"
    }),
    v5WeeklyCoach: async () => ({
      summary: "Review week: patience around confirmation gates.",
      insufficientData: empty,
      disclaimer: "Coach disclaimer"
    }),
    v5Personal: async () => ({
      ignoredWait: empty ? 0 : 2,
      averageR: empty ? null : 0.4,
      largestWinningStreak: 1,
      largestLosingStreak: 1,
      sampleWarning: "small"
    }),
    v5ScreenshotAnalyse: async () => ({ createsTrade: false }),
    v5GlossaryTerm: async () => ({ term: "POC", definition: "Point of control" }),
    v5PremiumAnalytics: async () =>
      empty
        ? {
            sampleSize: 2,
            shadowPlans: 1,
            sampleSizeWarning: "Sample too small for charts.",
            totalAnalyses: 3,
            candidates: 1,
            rejected: 2,
            wins: 0,
            losses: 0
          }
        : {
            sampleSize: 48,
            shadowPlans: 22,
            sampleSizeWarning: "Shadow sample — not proof of edge.",
            totalAnalyses: 120,
            candidates: 40,
            rejected: 55,
            wins: 12,
            losses: 10,
            expectancyR: 0.12,
            profitFactor: 1.15,
            maxDrawdownR: -2.1,
            averageWinR: 1.2,
            averageLossR: -1.0,
            averageMfe: 1.4,
            averageMae: 0.7,
            averageHoldBars: 8,
            unsafePlanCount: 0,
            planMutationCount: 0,
            rejectionReasons: { CONFIRMATION_INCOMPLETE: 18, RISK_GEOMETRY: 7 },
            strategyComparison: [
              { key: "A", sampleSize: 20, profitFactor: 1.2 },
              { key: "B", sampleSize: 14, profitFactor: 0.9 }
            ],
            sessionComparison: [
              { key: "LONDON", sampleSize: 20, profitFactor: 1.1 },
              { key: "NEWYORK", sampleSize: 18, profitFactor: 1.05 }
            ]
          },
    v5Learning: async () => ({ insights: ["Confirmation waits dominate rejections."] }),
    v5Replay: async () =>
      empty
        ? { frames: [], disclaimer: "Educational only" }
        : {
            frames: Array.from({ length: 24 }, (_, i) => ({
              barTime: `2026-07-21T${String(10 + (i % 10)).padStart(2, "0")}:${String(i).padStart(2, "0")}:00.000Z`,
              analysisSummary: `Bar ${i + 1} analysis`,
              candidateStatus: i % 3 === 0 ? "FORMING" : null,
              planStatus: i % 5 === 0 ? "SHADOW" : null,
              lifecycleNote: "Tracking",
              result: null
            })),
            disclaimer: "Educational only — shadow history."
          },
    getSettings: async () => ({
      notificationsEnabled: false,
      aiEnabled: false,
      provisionalSignalsEnabled: false,
      riskProfile: "BALANCED",
      manualRisk: {
        currency: "EUR",
        maxCashRiskPerTrade: 20,
        maxDailyRealisedLoss: 40,
        stopAfterConsecutiveLosses: 3,
        maxSimultaneousManualTrades: 1,
        valuePerPoint: 1,
        estimatedSpreadPoints: 0.3,
        noAveragingDown: true,
        noMartingale: true,
        noAutomaticRecovery: true
      },
      manualRiskLimitChangeLog: []
    }),
    listTradingViewConnections: async () => [],
    updateSettings: async (s: unknown) => s,
    createTradingViewConnection: async () => ({
      connection: { id: "x", status: "ACTIVE" }
    }),
    revokeTradingViewConnection: async () => ({}),
    sendTestAlert: async () => ({ message: "queued" }),
    getVapidPublicKey: async () => "",
    registerWebPushSubscription: async () => ({}),
    deleteWebPushSubscription: async () => ({}),
    autoTradeStatus: async (): Promise<AutoTradeStatus> => ({ ...autoTrade, activity: [...autoTrade.activity] }),
    autoTradeSetMode: async (mode: AutoTradeStatus["mode"], opts: {
      liveConfirmationPhrase?: string;
      riskAcknowledged?: boolean;
      accountVerified?: boolean;
    } = {}) => {
      if (mode === "IG_LIVE_AUTO") {
        if (!autoTrade.liveExecutionFeatureEnabled) {
          throw new ApiError(400, "LIVE_FEATURE_DISABLED", "LIVE execution is disabled by server feature flag for this release.");
        }
        if (opts.liveConfirmationPhrase !== "ENABLE LIVE AUTOTRADE") {
          throw new ApiError(400, "LIVE_CONFIRMATION_REQUIRED", "Type exactly: ENABLE LIVE AUTOTRADE");
        }
      }
      autoTrade = {
        ...autoTrade,
        mode,
        displayStatus:
          mode === "OFF"
            ? "OFF"
            : mode === "SHADOW"
              ? "SHADOW"
              : mode === "IG_DEMO_AUTO"
                ? "DEMO"
                : "LIVE",
        locked: false,
        activity: [
          {
            id: `m-${Date.now()}`,
            at: new Date().toISOString(),
            message: `Mode set to ${mode}.`,
            level: "success"
          },
          ...autoTrade.activity
        ]
      };
      return { ...autoTrade };
    },
    autoTradeConnect: async (environment: "DEMO" | "LIVE") => {
      autoTrade = {
        ...autoTrade,
        connection: {
          ...autoTrade.connection,
          connected: true,
          environment,
          environmentLabel: "IG DEMO — READ ONLY",
          connectionState: "Connected",
          accountIdMasked: environment === "LIVE" ? "****9988" : "****1234",
          accountName: environment === "LIVE" ? "Live CFD" : "Demo CFD",
          balance: 10000,
          available: 9500,
          marginUsed: 120,
          marketName: "Spot Gold",
          marketEpic: "CS.D.USCGC.TODAY.IP",
          marketStatus: "TRADEABLE",
          bid: 2385.2,
          ask: 2385.5,
          spread: 0.3,
          minDealSize: 0.1,
          sizeIncrement: 0.1,
          valuePerPoint: 1,
          minNormalStopDistance: 0.3,
          minGuaranteedStopDistance: 0.5,
          guaranteedStopAvailable: true,
          lastHeartbeatAt: new Date().toISOString()
        },
        proposedEpic: "CS.D.USCGC.TODAY.IP",
        goldCandidates: [
          {
            epic: "CS.D.USCGC.TODAY.IP",
            instrumentName: "Spot Gold",
            instrumentType: "CURRENCIES",
            expiry: "-",
            marketStatus: "TRADEABLE",
            currencyCode: "EUR",
            bid: 2385.2,
            offer: 2385.5,
            proposedPrimary: true,
            reason: "Review mock Spot Gold"
          }
        ],
        activity: [
          {
            id: `c-${Date.now()}`,
            at: new Date().toISOString(),
            message: `Connected to IG DEMO — READ ONLY (scaffold / review).`,
            level: "success"
          },
          ...autoTrade.activity
        ]
      };
      return { ...autoTrade };
    },
    autoTradeDisconnect: async () => {
      autoTrade = {
        ...autoTrade,
        connection: {
          ...autoTrade.connection,
          connected: false,
          connectionState: "Disconnected",
          lastHeartbeatAt: null
        }
      };
      return { ...autoTrade };
    },
    autoTradeEmergencyStop: async () => {
      autoTrade = {
        ...autoTrade,
        mode: "OFF",
        displayStatus: "LOCKED",
        locked: true,
        lockReason: "emergency_stop",
        emergencyStopActive: true,
        activity: [
          {
            id: `s-${Date.now()}`,
            at: new Date().toISOString(),
            message: "EMERGENCY STOP — AutoTrade locked and set to OFF.",
            level: "error"
          },
          ...autoTrade.activity
        ]
      };
      return { ...autoTrade };
    },
    autoTradeUnlock: async () => {
      autoTrade = {
        ...autoTrade,
        mode: "OFF",
        displayStatus: "OFF",
        locked: false,
        lockReason: null,
        emergencyStopActive: false,
        activity: [
          {
            id: `u-${Date.now()}`,
            at: new Date().toISOString(),
            message: "AutoTrade unlocked. Mode remains OFF until you enable it.",
            level: "info"
          },
          ...autoTrade.activity
        ]
      };
      return { ...autoTrade };
    },
    autoTradeUpdateLimits: async () => ({ ...autoTrade }),
    autoTradeDemoDiagnostics: async () => {
      autoTrade = {
        ...autoTrade,
        connection: {
          ...autoTrade.connection,
          connected: true,
          environment: "DEMO",
          environmentLabel: "IG DEMO — READ ONLY",
          connectionState: "Connected",
          accountIdMasked: "****1234",
          accountName: "Demo CFD",
          balance: 10000,
          available: 9500,
          marginUsed: 120,
          marketName: "Spot Gold",
          marketEpic: "CS.D.USCGC.TODAY.IP",
          marketStatus: "TRADEABLE",
          bid: 2385.2,
          ask: 2385.5,
          spread: 0.3,
          minDealSize: 0.1,
          sizeIncrement: 0.1,
          valuePerPoint: 1,
          minNormalStopDistance: 0.3,
          minGuaranteedStopDistance: 0.5,
          guaranteedStopAvailable: true,
          lastHeartbeatAt: new Date().toISOString()
        }
      };
      return { ...autoTrade };
    }
  };
}

export function UiReviewGate() {
  if (typeof window !== "undefined" && !isUiReviewHost()) {
    return <Navigate to="/" replace />;
  }
  return <UiReviewApp />;
}

function UiReviewApp() {
  const location = useLocation();
  const value = useMemo<AuthContextValue>(() => {
    const api = buildReviewApi();
    return {
      user: { email: "review@goldmeta.preview" } as AuthContextValue["user"],
      loading: false,
      configured: true,
      api: api as unknown as AuthContextValue["api"],
      signIn: async () => undefined,
      signUp: async () => undefined,
      signOut: async () => undefined,
      apiBaseUrl: "review://local"
    };
  }, [location.search]);

  useEffect(() => {
    document.documentElement.dataset.uiReview = "1";
    if (new URLSearchParams(window.location.search).get("offline") === "1") {
      document.documentElement.dataset.uiReviewOffline = "1";
    } else {
      delete document.documentElement.dataset.uiReviewOffline;
    }
    return () => {
      delete document.documentElement.dataset.uiReview;
      delete document.documentElement.dataset.uiReviewOffline;
    };
  }, [location.search]);

  return (
    <ReviewAuthProvider value={value}>
      <div data-testid="ui-review-shell" data-review-mode="1">
        <AppShell linkPrefix="/ui-review">
          <Routes>
            <Route index element={<OverviewPage />} />
            <Route path="intelligence" element={<IntelligencePage />} />
            <Route path="analytics" element={<PremiumAnalyticsPage />} />
            <Route path="replay" element={<ReplayPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="planner" element={<RiskPlannerPage />} />
            <Route path="autotrade" element={<AutoTradePage />} />
            <Route path="brand" element={<BrandConceptsPage />} />
            <Route path="history" element={<OverviewPage />} />
            <Route path="journal" element={<OverviewPage />} />
            <Route path="v4" element={<OverviewPage />} />
            <Route path="*" element={<OverviewPage />} />
          </Routes>
        </AppShell>
      </div>
    </ReviewAuthProvider>
  );
}
