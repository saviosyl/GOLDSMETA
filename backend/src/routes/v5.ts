import { Router } from "express";
import { getAuthenticatedUserId, requireAuth } from "../middleware/auth";
import type { GoldMetaStore } from "../services/storage/types";
import { v5Config, v5FlagSnapshot } from "../services/v5/config";
import { GLOSSARY, getGlossaryEntry } from "../services/v5/glossary";
import { answerMarketIntelligence } from "../services/v5/marketIntelligence";
import { computeGoldMetaScore, scoreInputFromV4Shadow } from "../services/v5/goldMetaScore";
import { computeLearningInsights } from "../services/v5/learningEngine";
import { buildDailyBriefing } from "../services/v5/briefing";
import { buildWeeklyCoachReport } from "../services/v5/weeklyCoach";
import { analyseScreenshotAgainstVerified } from "../services/v5/screenshotAnalysis";
import { buildReplaySession } from "../services/v5/replay";
import { computePersonalBehaviour } from "../services/v5/personalPerformance";
import { computePremiumAnalytics } from "../services/v5/premiumAnalytics";
import type { ScreenshotObservation } from "../services/v5/types";
import { v4Config } from "../services/v4/config";

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const envParam = (raw: unknown): "LIVE" | "TEST" => {
  const value =
    typeof raw === "string" ? raw : firstParam(raw as string | string[] | undefined);
  return (value ?? "LIVE").toUpperCase() === "TEST" ? "TEST" : "LIVE";
};

export const buildV5Router = (store: GoldMetaStore): Router => {
  const router = Router();

  router.get("/v1/v5/status", requireAuth, (_req, res) => {
    res.json({
      v5: {
        engineVersion: v5Config.engineVersion,
        configVersion: v5Config.configVersion,
        flags: v5FlagSnapshot(),
        brokerExecution: "DISABLED",
        overridesV4: false,
        productionDecisionSource: "V3 + V4 SHADOW only",
        intelligenceImplementation: "deterministic_rules_templated",
        aiEnabled: false,
        screenshotFeature: v5Config.flags.screenshotCompareEnabled
          ? "beta_structured_compare_no_vision_ocr"
          : "disabled",
        note: "V5 is a trading intelligence layer. It does not place orders or override V4. Ask GoldMeta is not an LLM."
      }
    });
  });

  router.get("/v1/v5/glossary", requireAuth, (_req, res) => {
    res.json({ glossary: GLOSSARY, offline: true });
  });

  router.get("/v1/v5/glossary/:slug", requireAuth, (req, res) => {
    const entry = getGlossaryEntry(String(req.params.slug ?? ""));
    if (!entry) {
      res.status(404).json({
        error: { code: "GLOSSARY_NOT_FOUND", message: "Unknown term" }
      });
      return;
    }
    res.json({ entry });
  });

  router.get("/v1/v5/briefing", requireAuth, async (req, res) => {
    if (!v5Config.flags.briefingEnabled) {
      res.status(503).json({ error: { code: "V5_BRIEFING_DISABLED", message: "Briefing disabled" } });
      return;
    }
    const userId = getAuthenticatedUserId(req);
    const environment = envParam(req.query.environment);
    const [latestDecision, analyses] = await Promise.all([
      store.latestDecision(userId),
      store.listV4ShadowAnalyses?.(userId, environment, 5) ?? Promise.resolve([])
    ]);
    const briefing = buildDailyBriefing({
      latestDecision: latestDecision?.environment === environment ? latestDecision : latestDecision,
      latestAnalysis: analyses[0] ?? null
    });
    res.json({ briefing, actionable: false });
  });

  router.post("/v1/v5/intelligence/ask", requireAuth, async (req, res) => {
    if (!v5Config.flags.intelligenceEnabled) {
      res.status(503).json({
        error: { code: "V5_INTELLIGENCE_DISABLED", message: "Intelligence disabled" }
      });
      return;
    }
    const userId = getAuthenticatedUserId(req);
    const question = String((req.body as { question?: string })?.question ?? "");
    const environment = envParam((req.body as { environment?: string })?.environment);
    const [latestDecision, analyses, candidates, plans] = await Promise.all([
      store.latestDecision(userId),
      store.listV4ShadowAnalyses?.(userId, environment, 30) ?? Promise.resolve([]),
      store.listV4ShadowCandidates?.(userId, environment, 30) ?? Promise.resolve([]),
      store.listV4ShadowPlans?.(userId, environment, 30) ?? Promise.resolve([])
    ]);
    const openPlan =
      plans.find(
        (p) =>
          p.status === "WAITING_FOR_ENTRY" ||
          p.status === "ENTERED" ||
          p.status === "TP1_HIT" ||
          p.status === "TP2_HIT"
      ) ?? null;
    const analytics = computePremiumAnalytics({
      filters: { environment },
      analyses,
      candidates,
      plans
    });
    const answer = answerMarketIntelligence({
      question,
      latestDecision,
      latestAnalysis: analyses[0] ?? null,
      previousAnalysis: analyses[1] ?? null,
      candidates,
      openPlan,
      analyticsSummary: {
        sampleSize: analytics.sampleSize,
        profitFactor: analytics.profitFactor,
        netExpectancyR: analytics.expectancyR,
        byStrategy: Object.fromEntries(
          analytics.strategyComparison.map((s) => [s.key, s.sampleSize])
        )
      }
    });
    res.json({ answer, actionable: false });
  });

  router.get("/v1/v5/score", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const environment = envParam(req.query.environment);
    const analyses =
      (await store.listV4ShadowAnalyses?.(userId, environment, 5)) ?? [];
    const a = analyses[0];
    if (!a) {
      res.json({
        score: null,
        insufficientData: true,
        message: "Insufficient verified data.",
        actionable: false
      });
      return;
    }
    const score = computeGoldMetaScore(
      scoreInputFromV4Shadow({
        bias: a.bias,
        regime: a.regime,
        profileSource: a.profileSource,
        gateFailures: a.gateFailures,
        rejectionReasons: a.rejectionReasons,
        session: a.session,
        atr: a.atr,
        gcConfirmation: a.gcConfirmation,
        absoluteMinPoints: v4Config.stop.absoluteMinPoints
      })
    );
    res.json({ score, analysisId: a.analysisId, actionable: false });
  });

  router.get("/v1/v5/learning", requireAuth, async (req, res) => {
    if (!v5Config.flags.learningEnabled) {
      res.status(503).json({ error: { code: "V5_LEARNING_DISABLED", message: "Learning disabled" } });
      return;
    }
    const userId = getAuthenticatedUserId(req);
    const environment = envParam(req.query.environment);
    const plans = (await store.listV4ShadowPlans?.(userId, environment, 500)) ?? [];
    const insights = computeLearningInsights({ environment, plans });
    res.json({ insights, actionable: false });
  });

  router.get("/v1/v5/analytics/premium", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const environment = envParam(req.query.environment);
    const strategy = typeof req.query.strategy === "string" ? req.query.strategy : undefined;
    const direction =
      req.query.direction === "BUY" || req.query.direction === "SELL"
        ? req.query.direction
        : undefined;
    const session = typeof req.query.session === "string" ? req.query.session : undefined;
    const regime = typeof req.query.regime === "string" ? req.query.regime : undefined;
    const [analyses, candidates, plans] = await Promise.all([
      store.listV4ShadowAnalyses?.(userId, environment, 500) ?? Promise.resolve([]),
      store.listV4ShadowCandidates?.(userId, environment, 500) ?? Promise.resolve([]),
      store.listV4ShadowPlans?.(userId, environment, 500) ?? Promise.resolve([])
    ]);
    const analytics = computePremiumAnalytics({
      filters: { environment, strategy, direction, session, regime },
      analyses,
      candidates,
      plans
    });
    res.json({ analytics, actionable: false });
  });

  router.get("/v1/v5/personal", requireAuth, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const [journal, setups] = await Promise.all([
      store.listJournalEntries(userId),
      store.listSetups(userId, 200)
    ]);
    const stats = computePersonalBehaviour({ journal, setups });
    res.json({ stats, actionable: false });
  });

  router.get("/v1/v5/coach/weekly", requireAuth, async (req, res) => {
    if (!v5Config.flags.weeklyCoachEnabled) {
      res.status(503).json({ error: { code: "V5_COACH_DISABLED", message: "Coach disabled" } });
      return;
    }
    const userId = getAuthenticatedUserId(req);
    const environment = envParam(req.query.environment);
    const [plans, analyses, journal] = await Promise.all([
      store.listV4ShadowPlans?.(userId, environment, 500) ?? Promise.resolve([]),
      store.listV4ShadowAnalyses?.(userId, environment, 500) ?? Promise.resolve([]),
      store.listJournalEntries(userId)
    ]);
    const report = buildWeeklyCoachReport({ plans, analyses, journal });
    res.json({ report, actionable: false });
  });

  router.post("/v1/v5/screenshot/analyse", requireAuth, async (req, res) => {
    if (!v5Config.flags.screenshotCompareEnabled) {
      res.status(503).json({
        error: { code: "V5_SCREENSHOT_DISABLED", message: "Screenshot compare disabled" }
      });
      return;
    }
    const userId = getAuthenticatedUserId(req);
    const body = (req.body ?? {}) as {
      environment?: string;
      observations?: ScreenshotObservation;
    };
    const environment = envParam(body.environment);
    const observations: ScreenshotObservation = body.observations ?? {};
    const analyses =
      (await store.listV4ShadowAnalyses?.(userId, environment, 5)) ?? [];
    const result = analyseScreenshotAgainstVerified({
      observations,
      latestAnalysis: analyses[0] ?? null
    });
    res.json({ result, actionable: false, createsTrade: false });
  });

  router.get("/v1/v5/replay", requireAuth, async (req, res) => {
    if (!v5Config.flags.replayEnabled) {
      res.status(503).json({ error: { code: "V5_REPLAY_DISABLED", message: "Replay disabled" } });
      return;
    }
    const userId = getAuthenticatedUserId(req);
    const environment = envParam(req.query.environment);
    const limit = Math.min(Number(req.query.limit) || 40, 120);
    const [analyses, candidates, plans] = await Promise.all([
      store.listV4ShadowAnalyses?.(userId, environment, 200) ?? Promise.resolve([]),
      store.listV4ShadowCandidates?.(userId, environment, 200) ?? Promise.resolve([]),
      store.listV4ShadowPlans?.(userId, environment, 200) ?? Promise.resolve([])
    ]);
    const session = buildReplaySession({
      environment,
      analyses,
      candidates,
      plans,
      limit
    });
    res.json({ session, actionable: false, educationalOnly: true });
  });

  return router;
};
