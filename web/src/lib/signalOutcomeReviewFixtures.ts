/**
 * UI-review fixtures for Signal History / Performance Playwright coverage.
 * Hypothetical only — no broker orders.
 */
import type { Decision, SignalOutcomeRecord, SignalPerformanceSummary } from "../types/models";

const baseDecision = (over: Partial<Decision> & { decisionId: string; decision: "BUY" | "SELL" | "WAIT" }): Decision =>
  ({
    schemaVersion: "3",
    symbol: "XAUUSD",
    timeframe: "M15",
    barTime: "2026-07-21T21:30:00.000Z",
    generatedAt: "2026-07-21T21:45:00.000Z",
    marketDataTime: "2026-07-21T21:45:00.000Z",
    validUntil: "2026-07-21T22:45:00.000Z",
    confidence: 82,
    confidenceLabel: "HIGH",
    marketRegime: "TREND",
    dataQuality: "GOOD",
    isProvisional: false,
    environment: "LIVE",
    setupScore: 75,
    entry: { type: "LIMIT", price: 2384.2 },
    stopLoss: { price: 2378 },
    takeProfits: [
      { label: "TP1", price: 2390 },
      { label: "TP2", price: 2395 },
      { label: "TP3", price: 2400 }
    ],
    riskReward: { tp1: 1, tp2: 1.8, tp3: 2.5 },
    bullishEvidence: [],
    bearishEvidence: [],
    reasonCodes: ["STRUCTURE"],
    reasonSummary: ["Review fixture"],
    warnings: [],
    missingInputs: [],
    invalidation: "—",
    disclaimer: "Analysis only",
    lifecycleState: "OPEN",
    ruleConfigVersion: "v3",
    backendVersion: "review",
    notificationSent: false,
    currentSession: "LONDON",
    ...over
  }) as Decision;

function outcome(
  decisionId: string,
  lifecycle: string,
  final: SignalOutcomeRecord["finalResult"],
  extra: Partial<SignalOutcomeRecord> = {}
): SignalOutcomeRecord {
  return {
    schemaVersion: "1.0",
    snapshot: {
      signalId: `sig-${decisionId}`,
      decisionId,
      symbol: "XAUUSD",
      timeframe: "M15",
      direction: decisionId.startsWith("wait") ? "WAIT" : "BUY",
      createdAt: "2026-07-21T21:45:00.000Z",
      proposedEntryPrice: 2384.2,
      entryZoneLow: null,
      entryZoneHigh: null,
      stopLoss: 2378,
      tp1: 2390,
      tp2: 2395,
      tp3: 2400,
      confidence: 82,
      dataQuality: "GOOD",
      environment: "LIVE"
    } as unknown as SignalOutcomeRecord["snapshot"],
    entry: {
      entryReached: lifecycle !== "PENDING_ENTRY" && lifecycle !== "WAIT_ONLY",
      entryTimestamp: lifecycle === "PENDING_ENTRY" ? null : "2026-07-21T22:00:00.000Z",
      entryPrice: lifecycle === "PENDING_ENTRY" ? null : 2384.2,
      expiredWithoutEntry: false
    },
    monitoring: {
      lifecycle,
      currentPrice: 2386,
      currentGrossPoints: lifecycle === "OPEN" ? 1.8 : null,
      currentRMultiple: lifecycle === "OPEN" ? 0.3 : null,
      timeInTradeMs: 600000,
      tp1Status: final?.targetsReached?.includes("TP1") ? "HIT" : "PENDING",
      tp2Status: final?.targetsReached?.includes("TP2") ? "HIT" : "PENDING",
      tp3Status: final?.targetsReached?.includes("TP3") ? "HIT" : "PENDING",
      stopStatus: final?.outcome === "LOSS" ? "HIT" : "ACTIVE"
    },
    finalResult: final,
    ...extra
  } as SignalOutcomeRecord;
}

export function buildSignalOutcomeReviewFixtures() {
  const decisions: Decision[] = [
    baseDecision({
      decisionId: "wait-1",
      decision: "WAIT",
      confidence: 42,
      confidenceLabel: "LOW",
      reasonSummary: ["Waiting for confirmation"]
    }),
    baseDecision({ decisionId: "pending-1", decision: "BUY", confidence: 65 }),
    baseDecision({ decisionId: "open-1", decision: "BUY", confidence: 72 }),
    baseDecision({ decisionId: "win-1", decision: "BUY", confidence: 90 }),
    baseDecision({ decisionId: "loss-1", decision: "BUY", confidence: 80 }),
    baseDecision({ decisionId: "be-1", decision: "BUY", confidence: 70 }),
    baseDecision({ decisionId: "amb-1", decision: "BUY", confidence: 69 }),
    baseDecision({ decisionId: "partial-1", decision: "BUY", confidence: 89 })
  ];

  const outcomes: SignalOutcomeRecord[] = [
    outcome("wait-1", "WAIT_ONLY", {
      outcome: null,
      exitReason: "WAIT signal — not a trade",
      exitTimestamp: null,
      exitPrice: null,
      entryPrice: null,
      grossPoints: null,
      netPoints: null,
      netR: null,
      holdingDurationMs: null,
      targetsReached: [],
      label: "HYPOTHETICAL SIGNAL PERFORMANCE",
      disclaimer: "Past hypothetical results do not guarantee future trading performance."
    }),
    outcome("pending-1", "PENDING_ENTRY", null),
    outcome("open-1", "OPEN", null),
    outcome(
      "win-1",
      "CLOSED",
      {
        outcome: "WIN",
        exitReason: "TP3",
        exitTimestamp: "2026-07-21T23:00:00.000Z",
        exitPrice: 2400,
        entryPrice: 2384.2,
        grossPoints: 12.4,
        netPoints: 12.3,
        netR: 2.0,
        holdingDurationMs: 3600000,
        targetsReached: ["TP1", "TP2", "TP3"],
        label: "HYPOTHETICAL SIGNAL PERFORMANCE",
        disclaimer: "Past hypothetical results do not guarantee future trading performance."
      }
    ),
    outcome(
      "loss-1",
      "CLOSED",
      {
        outcome: "LOSS",
        exitReason: "Stop",
        exitTimestamp: "2026-07-21T22:30:00.000Z",
        exitPrice: 2378,
        entryPrice: 2384.2,
        grossPoints: -6.2,
        netPoints: -6.3,
        netR: -1.0,
        holdingDurationMs: 1800000,
        targetsReached: [],
        label: "HYPOTHETICAL SIGNAL PERFORMANCE",
        disclaimer: "Past hypothetical results do not guarantee future trading performance."
      }
    ),
    outcome(
      "be-1",
      "CLOSED",
      {
        outcome: "BREAKEVEN",
        exitReason: "BE stop",
        exitTimestamp: "2026-07-21T22:45:00.000Z",
        exitPrice: 2384.2,
        entryPrice: 2384.2,
        grossPoints: 2.68,
        netPoints: 2.58,
        netR: 0.4,
        holdingDurationMs: 2400000,
        targetsReached: ["TP1"],
        label: "HYPOTHETICAL SIGNAL PERFORMANCE",
        disclaimer: "Past hypothetical results do not guarantee future trading performance."
      }
    ),
    outcome(
      "amb-1",
      "AMBIGUOUS_INTRABAR",
      {
        outcome: "AMBIGUOUS",
        exitReason: "Ambiguous intrabar",
        exitTimestamp: "2026-07-21T22:20:00.000Z",
        exitPrice: 2378,
        entryPrice: 2384.2,
        grossPoints: null,
        netPoints: null,
        netR: null,
        holdingDurationMs: 1200000,
        targetsReached: [],
        label: "HYPOTHETICAL SIGNAL PERFORMANCE",
        disclaimer: "Past hypothetical results do not guarantee future trading performance."
      }
    ),
    outcome(
      "partial-1",
      "CLOSED",
      {
        outcome: "WIN",
        exitReason: "Partial TP weighted",
        exitTimestamp: "2026-07-21T23:10:00.000Z",
        exitPrice: 2384.2,
        entryPrice: 2384.2,
        grossPoints: 2.68,
        netPoints: 2.58,
        netR: 0.42,
        holdingDurationMs: 3000000,
        targetsReached: ["TP1"],
        label: "HYPOTHETICAL SIGNAL PERFORMANCE",
        disclaimer: "Past hypothetical results do not guarantee future trading performance."
      }
    )
  ];

  const performance: SignalPerformanceSummary = {
    label: "HYPOTHETICAL SIGNAL PERFORMANCE",
    disclaimer: "Past hypothetical results do not guarantee future trading performance.",
    totalConfirmedBuySell: 7,
    pendingEntries: 1,
    openSignals: 1,
    closedSignals: 4,
    wins: 2,
    losses: 1,
    breakeven: 1,
    expired: 0,
    cancelled: 0,
    ambiguousIntrabar: 1,
    dataUnavailable: 0,
    waitOnly: 1,
    winRate: 50,
    netPoints: 8.58,
    netR: 1.82,
    averageWin: 7.44,
    averageLoss: -6.3,
    profitFactor: 2.1,
    maximumDrawdownR: -1,
    maximumConsecutiveLosses: 1,
    averageHoldingTimeMs: 2400000,
    tp1HitRate: 50,
    tp2HitRate: 25,
    tp3HitRate: 25,
    stopLossRate: 25,
    byDirection: { BUY: 7, SELL: 0 },
    byConfidenceRange: {
      "90-100": { count: 1, wins: 1, losses: 0 },
      "80-89": { count: 2, wins: 1, losses: 1 },
      "70-79": { count: 2, wins: 0, losses: 0 },
      "60-69": { count: 2, wins: 0, losses: 0 },
      "below-60": { count: 0, wins: 0, losses: 0 }
    }
  } as SignalPerformanceSummary;

  return { decisions, outcomes, performance };
}
