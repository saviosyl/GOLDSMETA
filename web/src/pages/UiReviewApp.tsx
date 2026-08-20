import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { AppShell } from "../components/layout/AppShell";
import { OverviewPage } from "./OverviewPage";
import { KeyLevelsPage } from "./KeyLevelsPage";
import { AlertsSetupPage } from "./AlertsSetupPage";
import { IntelligencePage } from "./IntelligencePage";
import { PremiumAnalyticsPage } from "./PremiumAnalyticsPage";
import { ReplayPage } from "./ReplayPage";
import { SettingsPage } from "./SettingsPage";
import { RiskPlannerPage } from "./RiskPlannerPage";
import { JournalPage } from "./JournalPage";
import { V4ResearchPage } from "./V4ResearchPage";
import { BrandConceptsPage } from "./BrandConceptsPage";
import { HistoryPage } from "./HistoryPage";
import { SignalPerformancePage } from "./SignalPerformancePage";
import { BrokerControlCentrePage } from "./broker/BrokerControlCentrePage";
import { HelpPage } from "./HelpPage";
import { LearnPage } from "./LearnPage";
import { AdminUsersPage } from "./admin/AdminUsersPage";
import { TradingViewSetupPage } from "./TradingViewSetupPage";
import { TradingViewTemplateAdminPage } from "./admin/TradingViewTemplateAdminPage";
import type { AuthContextValue } from "../lib/auth";
import { ReviewAuthProvider } from "../lib/auth";
import { QuoteProvider } from "../lib/quoteContext";
import { buildSignalOutcomeReviewFixtures } from "../lib/signalOutcomeReviewFixtures";
import { ApiError } from "../types/models";
import { chartExampleIntradayPlanFixture } from "../fixtures/intradayPlanFixture";
import { getIssue50PreviewCase } from "../preview/issue50PreviewMatrix";

/**
 * Preview-only UI review shell — no passwords or tokens.
 * Loaded only when VITE_ENABLE_UI_REVIEW=true (non-production builds).
 * Production builds dead-code-eliminate this module via UiReviewGate.
 */

function buildReviewApi() {
  const params = new URLSearchParams(window.location.search);
  const empty = params.get("empty") === "1";
  const offline = params.get("offline") === "1";
  const decisionOverride = (params.get("decision") || "WAIT").toUpperCase();
  const decisionCode =
    decisionOverride === "BUY" || decisionOverride === "SELL" ? decisionOverride : "WAIT";
  const scenario = params.get("scenario") ?? "";
  const signalOutcomes = scenario === "signal-outcomes";
  const marketMismatch = scenario === "market-mismatch" || scenario === "blocked";
  const marketMatch = scenario === "market-match";
  const formingScenario = [
    "watching",
    "prepare-buy",
    "prepare-sell",
    "buy-ready",
    "sell-ready",
    "wait-group"
  ].includes(scenario)
    ? scenario
    : "";
  const issue50Id = scenario.startsWith("issue50-")
    ? scenario.slice("issue50-".length)
    : scenario === "issue50"
      ? (params.get("case") ?? "below-val")
      : "";
  const issue50Case = issue50Id ? getIssue50PreviewCase(issue50Id) : undefined;
  const soFixtures = signalOutcomes ? buildSignalOutcomeReviewFixtures() : null;

  const nowIso = new Date().toISOString();
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
    dataQuality: "GOOD" as string,
    isProvisional: false,
    isTestDecision: false as boolean | null,
    dataSourceLabel: "LIVE" as string,
    environment: "LIVE",
    setupScore: 42,
    entry: {},
    stopLoss: {},
    takeProfits: [],
    riskReward: {},
    bullishEvidence: [],
    bearishEvidence: [],
    reasonCodes: ["CONFIRMATION_INCOMPLETE"] as string[],
    reasonSummary: ["Waiting for confirmation"] as string[],
    warnings: [] as string[],
    missingInputs: [],
    invalidation: "—",
    disclaimer: "Analysis only",
    lifecycleState: "OPEN",
    ruleConfigVersion: "v3",
    backendVersion: "review",
    notificationSent: false,
    currentSession: "NEWYORK",
    // Default UI-review uses Issue #50 labelled chart-example regime (~4034).
    lastKnownPrice: 4034.815 as number,
    ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: 4034.815, volume: 1200 },
    marketStructure: { trend: "RANGE", poc: 4045.087, vah: 4049.633, val: 4037.308 },
    symbolIdentity: {
      tradingViewSymbol: "XAUUSD",
      exchange: "OANDA",
      ctraderSymbolId: null as string | null,
      canonicalSymbol: "XAUUSD" as const
    },
    priceSources: {
      alertClose: {
        source: "TRADINGVIEW_ALERT",
        value: 4034.815,
        exchangeOrBroker: "OANDA"
      }
    }
  };

  // Labelled UI-review fixtures for PR #46 Market Structure mismatch / match.
  let briefingLevels = { poc: 4045.087, vah: 4049.633, val: 4037.308 };
  if (marketMismatch) {
    decision.decision = "WAIT";
    decision.dataQuality = "CONFLICTED";
    decision.dataSourceLabel = "TEST";
    decision.isTestDecision = true;
    decision.environment = "TEST";
    decision.lastKnownPrice = 2408;
    decision.ohlcv = { open: 2400, high: 2412, low: 2396, close: 2408, volume: 1 };
    decision.marketStructure = { trend: "RANGE", poc: 2408, vah: 2415, val: 2400 };
    decision.reasonCodes = ["PRICE_SOURCE_MISMATCH", "CONFLICTED_DATA"];
    decision.reasonSummary = [
      "TradingView alert price and broker/stored price disagree — signal blocked"
    ];
    decision.warnings = [
      "Market data mismatch: alert close 4045.17 disagrees with stored fixture 2408.00",
      "PRICE_SOURCE_MISMATCH"
    ];
    decision.symbolIdentity = {
      tradingViewSymbol: "XAUUSD",
      exchange: "TEST_FIXTURE",
      ctraderSymbolId: null,
      canonicalSymbol: "XAUUSD"
    };
    decision.priceSources = {
      alertClose: {
        source: "TEST_FIXTURE",
        value: 2408,
        exchangeOrBroker: "TEST_FIXTURE"
      }
    };
    // Intentionally mismatched V4-style levels so the client ladder shows the error state.
    briefingLevels = { poc: 4050.951, vah: 4052.975, val: 4047.193 };
  } else if (marketMatch) {
    decision.decision = "WAIT";
    decision.dataQuality = "GOOD";
    decision.dataSourceLabel = "LIVE";
    decision.isTestDecision = false;
    decision.environment = "LIVE";
    decision.marketDataTime = nowIso;
    decision.generatedAt = nowIso;
    decision.barTime = nowIso;
    // PR #46 match case stays in the ~4050 verified-alert regime.
    decision.lastKnownPrice = 4045.165;
    decision.ohlcv = { open: 4044, high: 4048, low: 4042, close: 4045.165, volume: 1200 };
    decision.marketStructure = {
      trend: "RANGE",
      poc: 4050.951,
      vah: 4052.975,
      val: 4047.193
    };
    decision.reasonCodes = ["CONFIRMATION_INCOMPLETE"];
    decision.reasonSummary = ["Waiting for confirmation"];
    decision.warnings = [];
    decision.symbolIdentity = {
      tradingViewSymbol: "XAUUSD",
      exchange: "OANDA",
      ctraderSymbolId: "42",
      canonicalSymbol: "XAUUSD"
    };
    decision.priceSources = {
      alertClose: {
        source: "TRADINGVIEW_ALERT",
        value: 4045.165,
        exchangeOrBroker: "OANDA"
      }
    };
    briefingLevels = { poc: 4050.951, vah: 4052.975, val: 4047.193 };
  }

  // Issue #50 labelled preview matrix — temporary non-production validation cases.
  if (issue50Case) {
    decision.decision = (issue50Case.decisionCode as "BUY" | "SELL" | "WAIT") || "WAIT";
    decision.lastKnownPrice = Number(issue50Case.decision.lastKnownPrice ?? decision.lastKnownPrice);
    decision.ohlcv = (issue50Case.decision.ohlcv as typeof decision.ohlcv) ?? decision.ohlcv;
    decision.marketStructure =
      (issue50Case.decision.marketStructure as typeof decision.marketStructure) ??
      decision.marketStructure;
    decision.dataQuality = String(issue50Case.decision.dataQuality ?? decision.dataQuality);
    decision.dataSourceLabel = String(
      issue50Case.decision.dataSourceLabel ?? decision.dataSourceLabel
    );
    decision.isTestDecision = Boolean(issue50Case.decision.isTestDecision ?? true);
    decision.environment = "TEST";
    decision.generatedAt = String(issue50Case.decision.generatedAt ?? decision.generatedAt);
    decision.marketDataTime = String(issue50Case.decision.marketDataTime ?? decision.marketDataTime);
    decision.currentSession = String(
      issue50Case.decision.currentSession ?? decision.currentSession
    );
    const ms = issue50Case.decision.marketStructure as
      | { poc?: number | null; vah?: number | null; val?: number | null }
      | null
      | undefined;
    briefingLevels = {
      poc: ms?.poc ?? null,
      vah: ms?.vah ?? null,
      val: ms?.val ?? null
    } as typeof briefingLevels;
    if (issue50Case.mode === "MISMATCH") {
      decision.reasonCodes = ["PRICE_SOURCE_MISMATCH", "CONFLICTED_DATA"];
      decision.warnings = [
        "Market data mismatch: preview quote and stored structure disagree",
        "PRICE_SOURCE_MISMATCH"
      ];
      decision.dataQuality = "CONFLICTED";
    }
  }

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
      entryPrice: 4036.0,
      entryType: "LIMIT",
      stopLoss: 4028.6,
      tp1: 4045.1,
      tp2: 4049.8,
      tp3: 4053.7
    },
    initialRisk: 7.4,
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

  if (marketMismatch) {
    // No trade plan while price sources conflict — avoid mixing ~2400 plan with ~4050 alert.
    setup.status = "REJECTED";
    (setup as { levels: Record<string, number | string | null> }).levels = {
      entryPrice: null,
      entryType: null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      tp3: null
    };
  } else if (marketMatch) {
    // Same ~4050 regime as the alert / structure ladder.
    setup.levels = {
      entryPrice: 4044.5,
      entryType: "LIMIT",
      stopLoss: 4038.0,
      tp1: 4055,
      tp2: 4062,
      tp3: 4070
    };
    setup.initialRisk = 6.5;
  }

  if (issue50Case) {
    if (issue50Case.mode === "MISMATCH" || issue50Case.mode === "LIVE_RANGE_ONLY") {
      setup.status = "REJECTED";
      (setup as { levels: Record<string, number | string | null> }).levels = {
        entryPrice: null,
        entryType: null,
        stopLoss: null,
        tp1: null,
        tp2: null,
        tp3: null
      };
    } else if (issue50Case.id === "buy-confirmed") {
      setup.direction = "BUY";
      setup.levels = {
        entryPrice: 4040,
        entryType: "LIMIT",
        stopLoss: 4030,
        tp1: 4050,
        tp2: 4055,
        tp3: 4060
      };
    } else if (issue50Case.id === "sell-confirmed") {
      (setup as { direction: "BUY" | "SELL" }).direction = "SELL";
      setup.levels = {
        entryPrice: 4042,
        entryType: "LIMIT",
        stopLoss: 4052,
        tp1: 4032,
        tp2: 4026,
        tp3: 4020
      };
    }
  }

  return {
    latestDecision: async () => (empty ? null : decision),
    latestDecisionPack: async () => {
      if (empty) return null;
      if (issue50Case) {
        const mode = issue50Case.mode;
        return {
          decision,
          latestQuote: decision,
          latestCompleteStrategySignal:
            mode === "MISMATCH" || mode === "LIVE_RANGE_ONLY" ? null : decision,
          marketStructureMode: mode,
          marketStructureDiagnostics: {
            lastWebhookOrDecisionAt: decision.generatedAt,
            lastCompleteSignalAt: mode === "COMPLETE" ? decision.generatedAt : null,
            schemaVersion: decision.schemaVersion,
            canonicalSymbol: "XAUUSD",
            exchangeOrBroker: "TEST_PREVIEW",
            timeframe: decision.timeframe,
            fieldsReceived: ["price", "ohlcv"],
            fieldsMissing: mode === "LIVE_RANGE_ONLY" ? ["poc", "vah", "val"] : [],
            fieldsRejected: [],
            rejectionReasons: mode === "MISMATCH" ? ["PRICE_SOURCE_MISMATCH"] : [],
            priceConsistencyOk: mode !== "MISMATCH",
            validityStatus:
              mode === "COMPLETE" ? "VALID" : mode === "MISMATCH" ? "MISMATCH" : "INCOMPLETE",
            marketStructureMode: mode,
            quoteAgeSeconds: issue50Case.quoteAgeSeconds,
            signalAgeSeconds: issue50Case.signalAgeSeconds,
            previewCaseId: issue50Case.id
          },
          structureDecisionId: decision.decisionId,
          // Review-only: mark as Pine 3 plan-source so UI exercises the enhanced path.
          // Fixture labels in copy are stripped by production display sanitizers.
          intradayPlan: {
            ...issue50Case.plan,
            planSourceKey:
              issue50Case.plan.planSourceKey ??
              `XAUUSD|REVIEW|${issue50Case.id}|PLAN_15M`,
            freshness: {
              ...issue50Case.plan.freshness,
              sourceLabel: issue50Case.plan.freshness?.sourceLabel ?? "GoldMeta Bridge 3.0.0"
            }
          }
        };
      }
      return {
        decision,
        latestQuote: decision,
        latestCompleteStrategySignal: marketMismatch
          ? null
          : marketMatch
            ? decision
            : decision.marketStructure?.poc != null
              ? decision
              : null,
        marketStructureMode: marketMismatch
          ? "MISMATCH"
          : formingScenario === "buy-ready" ||
              formingScenario === "sell-ready" ||
              formingScenario === "prepare-buy" ||
              formingScenario === "prepare-sell" ||
              decisionCode === "BUY" ||
              decisionCode === "SELL" ||
              marketMatch ||
              decision.marketStructure?.poc != null
            ? "COMPLETE"
            : "LIVE_RANGE_ONLY",
        marketStructureDiagnostics: {
          lastWebhookOrDecisionAt: decision.generatedAt,
          lastCompleteSignalAt:
            decision.marketStructure?.poc != null ? decision.generatedAt : null,
          schemaVersion: decision.schemaVersion,
          canonicalSymbol: "XAUUSD",
          exchangeOrBroker: decision.symbolIdentity?.exchange ?? null,
          timeframe: decision.timeframe,
          fieldsReceived: ["price", "ohlcv"],
          fieldsMissing: marketMismatch ? ["combined_structure"] : [],
          fieldsRejected: [],
          rejectionReasons: marketMismatch ? ["PRICE_SOURCE_MISMATCH"] : [],
          priceConsistencyOk: !marketMismatch,
          validityStatus: marketMatch ? "VALID" : marketMismatch ? "MISMATCH" : "INCOMPLETE",
          marketStructureMode: marketMismatch
            ? "MISMATCH"
            : marketMatch
              ? "COMPLETE"
              : "LIVE_RANGE_ONLY"
        },
        structureDecisionId: decision.decisionId,
        // Labelled Issue #50 fixture for UX review — never production defaults.
        // Default uses chart-example ~4034; market-match keeps PR #46 ~4050 ladder.
        intradayPlan: marketMismatch
          ? {
              ...chartExampleIntradayPlanFixture,
              action: "NO_TRADE",
              actionLabel: "NO TRADE",
              valueLocation: "UNKNOWN" as const,
              importantLevels: [],
              oneSentence:
                "Market structure sources disagree — stand aside until data is consistent. (LABELLED FIXTURE)",
              whyNotReady: "Price-source mismatch blocks important levels.",
              expectedRange: {
                ...chartExampleIntradayPlanFixture.expectedRange,
                rangeAvailable: false,
                unavailableReason:
                  "Range unavailable — market data mismatch blocks combining levels.",
                valueLocation: "UNKNOWN" as const,
                currentPrice: 2408,
                probableLow: null,
                probableHigh: null,
                stretchLow: null,
                stretchHigh: null
              },
              tradePlan: {
                ...chartExampleIntradayPlanFixture.tradePlan,
                cardKind: "NONE" as const,
                title: "No trade plan — data mismatch",
                actionable: false,
                direction: "NONE" as const,
                stopLoss: null,
                tp1: null,
                tp2: null,
                tp3: null,
                bullishConditional: null,
                bearishConditional: null
              }
            }
          : marketMatch
            ? {
                ...chartExampleIntradayPlanFixture,
                valueLocation: "BELOW_VALUE" as const,
                oneSentence:
                  "Matching price sources — complete structure available. (LABELLED FIXTURE — market-match)",
                // Keep a valid range around the ~4050 match quote (probableLow ≤ current ≤ probableHigh).
                expectedRange: {
                  ...chartExampleIntradayPlanFixture.expectedRange,
                  rangeAvailable: true,
                  unavailableReason: null,
                  valueLocation: "BELOW_VALUE" as const,
                  currentPrice: 4045.165,
                  probableLow: 4042,
                  probableHigh: 4047.193,
                  stretchLow: 4038,
                  stretchHigh: 4055,
                  remainingAbovePoints: 2.03,
                  remainingBelowPoints: 3.17
                },
                importantLevels: []
              }
            : formingScenario === "watching"
              ? {
                  ...chartExampleIntradayPlanFixture,
                  action: "NO_TRADE" as const,
                  actionLabel: "WATCHING",
                  planStatus: "NO_VALID_PLAN",
                  geometryValid: false,
                  oneSentence: "Price is approaching support — watching for a setup.",
                  whyNotReady: "AWAITING_5M_CONFIRMATION",
                  zones: {
                    ...chartExampleIntradayPlanFixture.zones,
                    nearestSupport: 4031.1,
                    nearestResistance: 4037.31
                  },
                  tradePlan: {
                    ...chartExampleIntradayPlanFixture.tradePlan,
                    actionable: false,
                    direction: "NONE" as const
                  }
                }
              : formingScenario === "prepare-buy"
                ? {
                    ...chartExampleIntradayPlanFixture,
                    action: "PREPARE" as const,
                    actionLabel: "PREPARE BUY",
                    planStatus: "WAITING_FOR_ENTRY_ZONE",
                    geometryValid: true,
                    confidence: 74,
                    confirmation5m: {
                      state: "PENDING",
                      label: "Pending"
                    } as typeof chartExampleIntradayPlanFixture.confirmation5m,
                    tradePlan: {
                      ...chartExampleIntradayPlanFixture.tradePlan,
                      direction: "BUY" as const,
                      actionable: true,
                      entryZone: "4,034.80 – 4,035.40",
                      stopLoss: 4031.1,
                      tp1: 4048.2,
                      tp2: 4053.7
                    },
                    planQuality: {
                      ...(chartExampleIntradayPlanFixture.planQuality as object),
                      reasons: ["AWAITING_5M_CONFIRMATION"]
                    } as typeof chartExampleIntradayPlanFixture.planQuality
                  }
                : formingScenario === "prepare-sell"
                  ? {
                      ...chartExampleIntradayPlanFixture,
                      action: "PREPARE" as const,
                      actionLabel: "PREPARE SELL",
                      planStatus: "WAITING_FOR_ENTRY_ZONE",
                      geometryValid: true,
                      confidence: 71,
                      confirmation5m: {
                        state: "PENDING",
                        label: "Pending"
                      } as typeof chartExampleIntradayPlanFixture.confirmation5m,
                      tradePlan: {
                        ...chartExampleIntradayPlanFixture.tradePlan,
                        direction: "SELL" as const,
                        actionable: true,
                        entryZone: "4,036.80 – 4,037.40",
                        stopLoss: 4041.2,
                        tp1: 4028.5,
                        tp2: 4024.0
                      },
                      planQuality: {
                        ...(chartExampleIntradayPlanFixture.planQuality as object),
                        reasons: ["AWAITING_5M_CONFIRMATION", "SOFT_DISAGREEMENT"]
                      } as typeof chartExampleIntradayPlanFixture.planQuality
                    }
                  : formingScenario === "buy-ready" || decisionCode === "BUY"
                    ? {
                        ...chartExampleIntradayPlanFixture,
                        action: "BUY" as const,
                        actionLabel: "BUY PLAN READY",
                        planStatus: "ARMED",
                        geometryValid: true,
                        confidence: 86,
                        confirmation5m: {
                          state: "BREAKOUT_CONFIRMED",
                          label: "Confirmed"
                        } as typeof chartExampleIntradayPlanFixture.confirmation5m,
                        tradePlan: {
                          ...chartExampleIntradayPlanFixture.tradePlan,
                          direction: "BUY" as const,
                          actionable: true,
                          entryZone: "4,034.80 – 4,035.40",
                          stopLoss: 4031.1,
                          tp1: 4048.2,
                          tp2: 4053.7,
                          tp3: 4058.0
                        }
                      }
                    : formingScenario === "sell-ready" || decisionCode === "SELL"
                      ? {
                          ...chartExampleIntradayPlanFixture,
                          action: "SELL" as const,
                          actionLabel: "SELL PLAN READY",
                          planStatus: "ARMED",
                          geometryValid: true,
                          confidence: 84,
                          confirmation5m: {
                            state: "REJECTION_CONFIRMED",
                            label: "Confirmed"
                          } as typeof chartExampleIntradayPlanFixture.confirmation5m,
                          tradePlan: {
                            ...chartExampleIntradayPlanFixture.tradePlan,
                            direction: "SELL" as const,
                            actionable: true,
                            entryZone: "4,036.80 – 4,037.40",
                            stopLoss: 4041.2,
                            tp1: 4028.5,
                            tp2: 4024.0
                          }
                        }
                      : chartExampleIntradayPlanFixture,
        marketFeedHealth: {
          status: marketMismatch ? ("red" as const) : ("green" as const),
          title: marketMismatch ? "Market feed unavailable" : "GoldMeta Market Feed",
          subtitle: marketMismatch
            ? "15M and 5M data did not belong to the same decision window."
            : "15M plan and 5M confirmation active",
          quoteStatus: marketMismatch ? ("unknown" as const) : ("live" as const),
          lastVerifiedAt: nowIso,
          lastVerifiedLabel: "12 seconds ago"
        }
      };
    },
    listActiveSetups: async () =>
      empty || marketMismatch || issue50Case?.mode === "MISMATCH" ? [] : [setup],
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
            positionVsPoc: marketMismatch
              ? "UNKNOWN"
              : marketMatch
                ? "BELOW_POC"
                : "ABOVE_POC",
            atrLabel: "NORMAL",
            atrValue: 12.4,
            levels: briefingLevels,
            tradingViewAlertClose: marketMismatch
              ? 4045.165
              : marketMatch
                ? 4045.165
                : decision.ohlcv.close,
            decisionClose: decision.lastKnownPrice,
            currentState: "WAIT",
            insufficientData: false,
            dataTimestamp: decision.generatedAt,
            explanations: marketMismatch
              ? [
                  "Market data mismatch: V4 close 4045.165 vs decision close 2408. Levels not combined in production briefing.",
                  "UI-review fixture intentionally returns mismatched levels to exercise the client guard."
                ]
              : [],
            verifiedFacts: marketMismatch
              ? ["TEST_FIXTURE OHLC ~2408", "TradingView/V4 levels ~4050"]
              : marketMatch
                ? ["OANDA XAUUSD close 4045.165", "POC/VAH/VAL same regime"]
                : [],
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
      connection: {
        id: "review-user-wh",
        status: "ACTIVE",
        webhookURL:
          "https://us-central1-example.cloudfunctions.net/apiCTraderPreview/webhooks/tradingview/review-user-wh"
      },
      webhookUrl:
        "https://us-central1-example.cloudfunctions.net/apiCTraderPreview/webhooks/tradingview/review-user-wh",
      secret: "once-secret-review"
    }),
    revokeTradingViewConnection: async () => ({}),
    sendTestAlert: async () => ({ message: "queued", ok: true }),
    getVapidPublicKey: async () => "",
    registerWebPushSubscription: async () => ({}),
    deleteWebPushSubscription: async () => ({}),
    decisionHistory: async () => {
      if (soFixtures) return soFixtures.decisions;
      if (empty) return [];
      if (formingScenario === "wait-group") {
        return Array.from({ length: 8 }, (_, i) => ({
          ...decision,
          decisionId: `wait_group_${i}`,
          decision: "WAIT" as const,
          generatedAt: new Date(Date.parse("2026-08-06T10:00:00.000Z") + i * 12 * 60_000).toISOString(),
          reasonCodes: ["AWAITING_5M_CONFIRMATION", "WAIT_ONLY"],
          confidence: 40 + i
        }));
      }
      return [decision];
    },
    listSignalOutcomes: async () => (soFixtures ? soFixtures.outcomes : []),
    signalPerformance: async () =>
      soFixtures
        ? soFixtures.performance
        : {
            label: "HYPOTHETICAL SIGNAL PERFORMANCE",
            disclaimer: "Past hypothetical results do not guarantee future trading performance.",
            totalConfirmedBuySell: 0,
            pendingEntries: 0,
            openSignals: 0,
            closedSignals: 0,
            wins: 0,
            losses: 0,
            breakeven: 0,
            expired: 0,
            cancelled: 0,
            ambiguousIntrabar: 0,
            dataUnavailable: 0,
            waitOnly: 0,
            winRate: null,
            netPoints: 0,
            netR: 0,
            averageWin: null,
            averageLoss: null,
            profitFactor: null,
            maximumDrawdownR: 0,
            maximumConsecutiveLosses: 0,
            averageHoldingTimeMs: null,
            tp1HitRate: null,
            tp2HitRate: null,
            tp3HitRate: null,
            stopLossRate: null,
            byDirection: { BUY: 0, SELL: 0 },
            byConfidenceRange: {}
          },
    signalOutcomeByDecision: async (id: string) =>
      soFixtures?.outcomes.find((o) => o.snapshot.decisionId === id) ?? null,
    getBrokerControlCentre: async () => ({
      defaultBroker: "pepperstone_ctrader",
      autoTrade: "OFF",
      orderSubmissionEnabled: false,
      brokers: [
        {
          id: "pepperstone_ctrader",
          name: "Pepperstone cTrader",
          status: "Connected",
          detail:
            "Multi-user Demo/Live accounts — AutoTrade OFF — order submission temporarily disabled",
          badge: "PREVIEW"
        },
        {
          id: "trading212_invest",
          name: "Trading 212 Practice",
          status: "Read only",
          detail: "Separate gold-proxy path — not part of the cTrader AutoTrade workflow",
          badge: "READ_ONLY"
        },
        {
          id: "manual",
          name: "Manual",
          status: "Available",
          detail: "Analysis only — no broker execution",
          badge: "MANUAL"
        }
      ],
      automationModes: [],
      readiness: {
        setupRequired: false,
        authSetupRequired: false,
        oauthConfigured: true,
        missingConfigurationItems: [],
        connected: true,
        demonstrationAvailable: true,
        automationMode: "OFF",
        autoTrade: "OFF",
        orderSubmissionEnabled: false,
        liveEnabled: false,
        connectionSummary: {
          accountMasked: "48…06",
          brokerName: "Pepperstone - Europe",
          symbolName: "XAUUSD",
          lastSyncAt: new Date().toISOString(),
          lastQuoteAt: new Date().toISOString()
        },
        wizardSteps: [
          {
            step: 1,
            title: "Create Pepperstone cTrader Demo account",
            status: "AVAILABLE",
            detail: "TradingView alone is not enough."
          },
          {
            step: 2,
            title: "Register cTrader Open API application",
            status: "SETUP_REQUIRED",
            detail: "Create a Demo Open API app."
          },
          {
            step: 3,
            title: "Add secure credentials",
            status: "SETUP_REQUIRED",
            detail: "Store secrets in Secret Manager only."
          },
          {
            step: 4,
            title: "Connect account",
            status: "SETUP_REQUIRED",
            detail: "OAuth connect — no broker password."
          },
          {
            step: 5,
            title: "Verify XAUUSD",
            status: "SETUP_REQUIRED",
            detail: "Symbol metadata checks."
          },
          {
            step: 6,
            title: "Run read-only checks",
            status: "SETUP_REQUIRED",
            detail: "Bid/ask, spread, market-open."
          },
          {
            step: 7,
            title: "Run trade previews",
            status: "SETUP_REQUIRED",
            detail: "Preview only — no orders."
          },
          {
            step: 8,
            title: "Request Demo trading approval",
            status: "BLOCKED",
            detail: "Demo trading stays locked."
          }
        ],
        label: "Pepperstone connection required — Trading locked — AutoTrade OFF",
        auth: { status: "HEALTHY", brokerSetupEnabled: true, notes: [] },
        qualification: {
          unlocked: false,
          canActivate: false,
          failed: ["OAUTH_HEALTHY"],
          progress: {
            completedPreviews: 0,
            requiredPreviews: 20,
            approvedControlledDemoTrades: 0,
            requiredTrades: 5,
            daysSinceFirstTrade: null,
            requiredDays: 7,
            source: "recommended_qualification_defaults",
            sourceLabel:
              "Recommended qualification defaults for future Demo Auto approval — not permanent user risk limits."
          }
        }
      }
    }),
    getCTraderDiagnostics: async () => ({
      oauthConnected: true,
      accountSelected: true,
      demoAccountSelected: false,
      credentialsConfigured: true,
      pepperstoneConfirmed: true,
      goldSymbolFound: true,
      liveQuoteReceived: true,
      spreadAvailable: true,
      volumeRulesAvailable: true,
      marginMetadataAvailable: true,
      marketStatusAvailable: true,
      tradingSafelyLocked: true,
      autoTrade: "OFF",
      environment: "LIVE",
      selectedAccountIsLive: true,
      connection: {
        accountMasked: "48…06",
        brokerName: "Pepperstone - Europe",
        currency: "EUR",
        symbolName: "XAUUSD",
        tokenRefreshHealthy: true
      },
      account: {
        accountIdMasked: "48…06",
        currency: "EUR",
        balance: 50,
        equity: 50,
        freeMargin: 50,
        usedMargin: 0,
        leverage: 30
      },
      symbol: {
        symbolName: "XAUUSD",
        minVolume: 0.01,
        volumeStep: 0.01
      },
      quote: {
        bid: 4265.1,
        ask: 4265.31,
        spread: 0.21,
        marketStatus: "OPEN",
        stale: false,
        timestamp: new Date().toISOString()
      }
    }),
    listCTraderAccounts: async () => ({
      accounts: [
        {
          ctidTraderAccountId: "live-4706",
          accountIdMasked: "48…06",
          isLive: true,
          selected: true,
          brokerNameTitle: "Pepperstone - Europe",
          depositCurrency: "EUR",
          balance: 50,
          connectionStatus: "Connected",
          tradingPermission: "Read only"
        },
        {
          ctidTraderAccountId: "demo-4821",
          accountIdMasked: "****4821",
          isLive: false,
          selected: false,
          brokerNameTitle: "Pepperstone",
          depositCurrency: "EUR",
          balance: 10000,
          connectionStatus: "Connected",
          tradingPermission: "Read only"
        }
      ]
    }),
    getTradingViewSetup: async () => ({
      setup: {
        templateMode: "standard",
        templateId: "goldmeta-standard-v1",
        templateVersion: "1.0.0",
        connectionStatus: "waiting_for_alert",
        setupLabel: "GoldMeta Standard",
        selectedSymbolAlias: "XAUUSD",
        selectedTimeframes: ["15"],
        lastSignalAt: null,
        lastValidSignalAt: null,
        lastRejectedSignalAt: null,
        lastRejectReason: null,
        hasWebhook: true,
        webhookIdMasked: "wh…view"
      },
      template: {
        id: "goldmeta-standard-v1",
        name: "GoldMeta Standard TradingView Template",
        description: "Use the shared GoldMeta alert format. Fastest way to get started.",
        recommended: true,
        supportedTimeframes: [
          { value: "15", label: "15 minutes" },
          { value: "30", label: "30 minutes" },
          { value: "60", label: "1 hour" }
        ],
        symbolAliases: { XAUUSD: "XAUUSD" },
        instructions: ["Create alert", "Paste webhook", "Paste message"]
      },
      webhookUrl:
        "https://us-central1-example.cloudfunctions.net/apiCTraderPreview/webhooks/tradingview/review-user-wh",
      alertGuide: {
        alertName: "GoldMeta XAUUSD 15",
        messageBody: '{"schemaVersion":"1.0","symbol":"{{ticker}}","action":"{{strategy.order.action}}"}',
        pineReminder: "Use the GoldMeta Standard alert message."
      }
    }),
    updateTradingViewSetup: async () => ({ ok: true }),
    restoreTradingViewStandard: async () => ({ ok: true }),
    saveTradingViewCustomMapping: async () => ({ ok: true }),
    rotateTradingViewConnection: async () => ({
      webhookUrl:
        "https://us-central1-example.cloudfunctions.net/apiCTraderPreview/webhooks/tradingview/review-user-wh",
      secret: "rotated-once"
    }),
    selectCTraderAccount: async () => ({ ok: true }),
    createCTraderPreview: async () => ({
      notice: "Order submission is currently disabled in this preview.",
      preview: {
        action: "BUY",
        state: "READY_FOR_CONFIRMATION",
        proposedVolume: 0.02,
        riskAmount: 20
      },
      quote: { bid: 2350.1, ask: 2350.4, spread: 0.3 }
    }),
    disconnectCTrader: async () => ({ disconnected: true }),
    setCTraderEmergencyStop: async () => ({ ok: true }),
    getAdminTradingViewTemplate: async () => ({
      active: {
        id: "goldmeta-standard-v1",
        name: "GoldMeta Standard TradingView Template",
        version: "1.0.0",
        status: "published"
      },
      templates: [
        {
          id: "goldmeta-standard-v1",
          version: "1.0.0",
          status: "published"
        }
      ]
    }),
    publishAdminTradingViewTemplate: async () => ({ ok: true }),
    getCTraderDemonstration: async () => ({
      banner: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED",
      notice: "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED",
      autoTrade: "OFF",
      orderSubmissionEnabled: false,
      account: {
        accountIdMasked: "DE…01",
        currency: "EUR",
        balance: 10000,
        equity: 10000,
        freeMargin: 9500,
        leverage: 100,
        brokerName: "Pepperstone",
        brokerNameSource: "FIXTURE"
      },
      symbol: {
        symbolName: "XAUUSD",
        baseAsset: "XAU",
        quoteAsset: "USD",
        minVolume: 0.01,
        volumeStep: 0.01,
        lotSize: 100,
        metadataComplete: true
      },
      quote: {
        bid: 2350,
        ask: 2350.3,
        spread: 0.3,
        marketStatus: "OPEN",
        source: "FIXTURE"
      },
      buyPreview: {
        state: "READY_FOR_CONFIRMATION",
        action: "BUY",
        proposedVolume: 0.02,
        riskAmount: 20,
        failedGates: [],
        passedGates: [],
        label: "DEMONSTRATION DATA"
      },
      sellPreview: {
        state: "READY_FOR_CONFIRMATION",
        action: "SELL",
        proposedVolume: 0.02,
        label: "DEMONSTRATION DATA"
      },
      blockedPreview: {
        state: "BLOCKED",
        failedGates: ["CONFIDENCE_TOO_LOW"],
        label: "DEMONSTRATION DATA"
      }
    }),
    startCTraderOAuth: async () => {
      throw new ApiError(403, "CTRADER_SETUP_REQUIRED", "Secure credentials not added yet");
    },
    listAdminUsers: async () => ({
      users: [
        {
          userId: "review_u1",
          userIdMasked: "re…u1",
          firstName: "Ada",
          lastName: "Review",
          email: "ada.review@example.com",
          registeredAt: "2026-07-20T00:00:00.000Z",
          emailVerified: true,
          approvalStatus: "USER_PENDING",
          role: "USER",
          lastSignInAt: null,
          suspended: false
        }
      ]
    }),
    adminUserAction: async () => ({ ok: true }),
    marketFeedHealth: async () => ({
      status: "green",
      title: "GoldMeta Market Feed",
      subtitle: "All systems operational",
      quoteStatus: "live",
      lastVerifiedAt: new Date().toISOString(),
      lastVerifiedLabel: "12 seconds ago"
    }),
    notificationPreferences: async () => ({
      VALID_PLAN_CREATED: true,
      ENTRY_ZONE_APPROACHING: true,
      ENTRY_ZONE_REACHED: true,
      CONFIRM_5M: true,
      PLAN_INVALIDATED: true,
      TARGETS_REACHED: true
    }),
    updateNotificationPreferences: async (patch: Record<string, boolean>) => ({
      VALID_PLAN_CREATED: true,
      ENTRY_ZONE_APPROACHING: true,
      ENTRY_ZONE_REACHED: true,
      CONFIRM_5M: true,
      PLAN_INVALIDATED: true,
      TARGETS_REACHED: true,
      ...patch
    }),
    listNotifications: async () => [
      {
        id: "n1",
        event: "VALID_PLAN_CREATED",
        direction: "BUY",
        createdAt: new Date().toISOString(),
        message: "Valid buy plan ready — review entry zone before acting.",
        read: false
      }
    ],
    adminMarketFeedStatus: async () => ({
      health: {
        status: "green",
        title: "GoldMeta Market Feed",
        subtitle: "All systems operational",
        quoteStatus: "live",
        lastVerifiedAt: new Date().toISOString(),
        lastVerifiedLabel: "12 seconds ago"
      },
      checklist: [
        { id: "pine30", label: "Pine 3.0 detected", status: "pass" },
        { id: "plan15m", label: "PLAN_15M received", status: "pass" },
        { id: "confirm5m", label: "CONFIRM_5M received", status: "pass" },
        { id: "quote1m", label: "QUOTE_1M optional", status: "optional" },
        { id: "legacy", label: "No recent legacy Bridge traffic", status: "pass" }
      ],
      sharedWebhookUrl: "https://example.test/webhook/shared"
    })
  };
}

export default function UiReviewApp() {
  const location = useLocation();
  const value = useMemo<AuthContextValue>(() => {
    const api = buildReviewApi();
    const staffPreview =
      new URLSearchParams(location.search).get("staff") === "1" ||
      new URLSearchParams(location.search).get("role") === "OWNER";
    return {
      user: { email: "review@goldmeta.preview" } as AuthContextValue["user"],
      loading: false,
      configured: true,
      api: api as unknown as AuthContextValue["api"],
      signIn: async () => undefined,
      signUp: async () => {
        throw new Error("Account registration is currently closed.");
      },
      registrationEnabled: false,
      account: {
        // Default review role matches ordinary approved users (webhook URL hidden).
        // Use ?staff=1 or ?role=OWNER for admin chrome in UI review.
        role: staffPreview ? "OWNER" : "USER",
        access: "APP",
        emailVerified: true,
        approvalStatus: "APPROVED",
        uidMasked: "re****ew",
        profile: { brokerMessage: "Broker access is separate from account approval." }
      } as AuthContextValue["account"],
      accountLoading: false,
      accountError: null,
      accountResolved: true,
      refreshAccount: async () => null,
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
      <QuoteProvider>
      <div data-testid="ui-review-shell" data-review-mode="1">
        <AppShell linkPrefix="/ui-review">
          <Routes>
            <Route index element={<OverviewPage />} />
            <Route path="levels" element={<KeyLevelsPage />} />
            <Route path="alerts" element={<AlertsSetupPage />} />
            <Route path="intelligence" element={<IntelligencePage />} />
            <Route path="analytics" element={<PremiumAnalyticsPage />} />
            <Route path="replay" element={<ReplayPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="planner" element={<RiskPlannerPage />} />
            <Route path="autotrade" element={<Navigate to="/ui-review" replace />} />
            <Route path="brokers" element={<BrokerControlCentrePage />} />
            <Route path="tradingview" element={<TradingViewSetupPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="learn" element={<LearnPage />} />
            <Route path="learn/:lessonId" element={<LearnPage />} />
            <Route path="admin/users" element={<AdminUsersPage />} />
            <Route path="admin/tradingview-template" element={<TradingViewTemplateAdminPage />} />
            <Route path="brand" element={<BrandConceptsPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="signal-performance" element={<SignalPerformancePage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="v4" element={<V4ResearchPage />} />
            <Route
              path="account-ready"
              element={
                <div className="gm-auth-layout" data-testid="account-ready-page">
                  <div className="gm-auth-form-panel">
                    <div className="gm-auth-card">
                      <h1 className="gm-auth-title">Your account is ready</h1>
                      <p className="gm-auth-support" data-testid="account-ready-message">
                        Your email has been verified and your GoldMeta account is now active.
                      </p>
                      <a
                        className="gm-auth-submit"
                        href="/ui-review"
                        data-testid="account-ready-open-dashboard"
                      >
                        Open Dashboard
                      </a>
                    </div>
                  </div>
                </div>
              }
            />
            <Route path="*" element={<OverviewPage />} />
          </Routes>
        </AppShell>
      </div>
      </QuoteProvider>
    </ReviewAuthProvider>
  );
}
