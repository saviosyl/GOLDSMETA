import { describe, expect, it } from "vitest";
import { computeGoldMetaScore, scoreInputFromV4Shadow } from "../../src/services/v5/goldMetaScore";
import { answerMarketIntelligence } from "../../src/services/v5/marketIntelligence";
import { computeLearningInsights } from "../../src/services/v5/learningEngine";
import { buildDailyBriefing } from "../../src/services/v5/briefing";
import { buildWeeklyCoachReport } from "../../src/services/v5/weeklyCoach";
import { analyseScreenshotAgainstVerified } from "../../src/services/v5/screenshotAnalysis";
import { buildReplaySession } from "../../src/services/v5/replay";
import { computePremiumAnalytics } from "../../src/services/v5/premiumAnalytics";
import { getGlossaryEntry, GLOSSARY } from "../../src/services/v5/glossary";
import { v5Config } from "../../src/services/v5/config";
import type { V4LockedShadowPlan, V4ShadowAnalysisRecord } from "../../src/services/v4/shadowTypes";

const analysis = (overrides: Partial<V4ShadowAnalysisRecord> = {}): V4ShadowAnalysisRecord => ({
  analysisId: "a1",
  strategyVersion: "4",
  mode: "SHADOW",
  environment: "LIVE",
  eventId: "e1",
  parentDecisionId: "d1",
  barTime: "2026-07-21T10:00:00.000Z",
  timeframe: "15",
  ohlc: { open: 2650, high: 2652, low: 2648, close: 2651 },
  session: "LONDON",
  regime: "UPTREND",
  bias: "BUY_BIAS",
  atr: 10,
  atrPercentile: 0.5,
  xauPoc: 2650,
  vah: 2658,
  val: 2642,
  profileSource: "XAUUSD_TV",
  profileAsOf: "2026-07-21T10:00:00.000Z",
  gcConfirmation: "UNAVAILABLE",
  htfContext: "UPTREND",
  gateFailures: [],
  rejectionReasons: ["Multi-bar confirmation incomplete"],
  configVersion: "v4",
  profileVersion: "p4",
  engineVersion: "e4",
  generatedAt: "2026-07-21T10:00:00.000Z",
  actionable: false,
  ...overrides
});

describe("V5 GoldMeta Score", () => {
  it("is 0-100 and not probability", () => {
    const score = computeGoldMetaScore(
      scoreInputFromV4Shadow({
        bias: "BUY_BIAS",
        regime: "UPTREND",
        profileSource: "XAUUSD_TV",
        gateFailures: [],
        rejectionReasons: [],
        session: "LONDON",
        atr: 10,
        confirmationBarsSeen: 2,
        confirmationBarsRequired: 2,
        riskDistance: 5,
        absoluteMinPoints: 1.5,
        gcConfirmation: "UNAVAILABLE"
      })
    );
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.actionable).toBe(false);
    expect(score.disclaimer).toContain("not the probability");
    expect(score.components.length).toBeGreaterThanOrEqual(8);
  });
});

describe("V5 Market Intelligence", () => {
  it("answers WAIT with verified vs explanation split", () => {
    const answer = answerMarketIntelligence({
      question: "Why are we waiting?",
      latestAnalysis: analysis(),
      latestDecision: null
    });
    expect(answer.insufficientData).toBe(false);
    expect(answer.verifiedFacts.length).toBeGreaterThan(0);
    expect(answer.explanations.length).toBeGreaterThan(0);
    expect(answer.disclaimer).toContain("Verified");
  });

  it("returns insufficient data honestly when empty", () => {
    const answer = answerMarketIntelligence({
      question: "Why are we waiting?",
      latestAnalysis: null,
      latestDecision: null
    });
    expect(answer.insufficientData).toBe(true);
    expect(answer.answer.toLowerCase()).toContain("insufficient verified data");
  });
});

describe("V5 learning / analytics / coach", () => {
  it("does not self-modify rules", () => {
    const insights = computeLearningInsights({ environment: "LIVE", plans: [] });
    expect(insights.selfModifiesRules).toBe(false);
    expect(insights.resolvedSample).toBe(0);
  });

  it("builds briefing without creating a trade", () => {
    const briefing = buildDailyBriefing({ latestAnalysis: analysis() });
    expect(briefing.actionable).toBe(false);
    expect(briefing.levels.poc).toBe(2650);
  });

  it("weekly coach refuses to fabricate when empty", () => {
    const report = buildWeeklyCoachReport({ plans: [], analyses: [], journal: [] });
    expect(report.insufficientData).toBe(true);
    expect(report.actionable).toBe(false);
  });

  it("premium analytics stays non-actionable", () => {
    const analytics = computePremiumAnalytics({
      filters: { environment: "LIVE" },
      analyses: [analysis()],
      candidates: [],
      plans: []
    });
    expect(analytics.actionable).toBe(false);
    expect(analytics.totalAnalyses).toBe(1);
  });
});

describe("V5 screenshot / replay / glossary", () => {
  it("never creates a trade from screenshot", () => {
    const result = analyseScreenshotAgainstVerified({
      observations: { trend: "bullish", session: "LONDON", visibleVolumeProfile: { poc: 2650 } },
      latestAnalysis: analysis()
    });
    expect(result.createsTrade).toBe(false);
    expect(result.agreements.length + result.disagreements.length).toBeGreaterThan(0);
  });

  it("replay is educational only", () => {
    const session = buildReplaySession({
      environment: "LIVE",
      analyses: [analysis(), analysis({ analysisId: "a2", barTime: "2026-07-21T10:15:00.000Z" })],
      candidates: [],
      plans: [] as V4LockedShadowPlan[]
    });
    expect(session.educationalOnly).toBe(true);
    expect(session.frames.length).toBe(2);
  });

  it("glossary is offline and complete for core terms", () => {
    expect(GLOSSARY.length).toBeGreaterThan(10);
    expect(getGlossaryEntry("poc")?.term).toBe("POC");
    expect(getGlossaryEntry("atr")?.howGoldMetaUsesIt).toContain("stop");
  });

  it("keeps broker disabled in V5 config", () => {
    expect(v5Config.brokerExecution).toBe("DISABLED");
    expect(v5Config.overridesV4).toBe(false);
  });
});
