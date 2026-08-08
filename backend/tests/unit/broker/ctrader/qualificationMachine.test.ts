import { describe, expect, it } from "vitest";
import {
  allowsDemoOrderSubmission,
  buildSetupBlockers,
  deriveAdvancedState,
  observationProgress,
  setupReady,
  toPublicView
} from "../../../../src/services/broker/ctrader/qualificationMachine";
import { createEmptyQualificationDoc } from "../../../../src/services/broker/ctrader/qualificationStore";
import { evaluateQualificationCandidate } from "../../../../src/services/broker/ctrader/qualificationEvaluator";
import { QUALIFICATION_GATES } from "../../../../src/services/broker/ctrader/qualificationTypes";

const readySetup = {
  authenticated: true,
  approved: true,
  oauthConnected: true,
  demoAccountSelected: true,
  accountIsLive: false,
  accountMasked: "48…10",
  accountId: "demo-1",
  symbolResolved: true,
  tradingScope: true,
  brokerQuoteHealthy: true,
  riskConfigured: true,
  emergencyStopHealthy: true,
  emergencyStopActive: false,
  dailyLimitsConfigured: true
};

describe("qualification setup gates", () => {
  it("starts only when ready", () => {
    expect(setupReady(buildSetupBlockers(readySetup))).toBe(true);
  });

  it("blocks Live account", () => {
    const blockers = buildSetupBlockers({ ...readySetup, accountIsLive: true, demoAccountSelected: false });
    expect(setupReady(blockers)).toBe(false);
    expect(blockers.find((b) => b.id === "oauth")?.ok).toBe(false);
  });

  it("requires trading scope", () => {
    const blockers = buildSetupBlockers({ ...readySetup, tradingScope: false });
    expect(setupReady(blockers)).toBe(false);
    expect(blockers.find((b) => b.id === "trading_scope")?.action).toMatch(/Authorise/);
  });
});

describe("qualification candidate evaluator", () => {
  const base = {
    direction: "BUY",
    signalId: "dec_1",
    entry: 2400,
    stopLoss: 2390,
    takeProfit: 2420,
    confidence: 85,
    minConfidence: 80,
    quoteBid: 2399,
    quoteAsk: 2400,
    quoteSpread: 1,
    quoteStale: false,
    marketStatus: "OPEN",
    maxSpread: 2,
    maxQuoteAgeSeconds: 30,
    quoteAgeSeconds: 5,
    alreadyCountedSignal: false
  };

  it("rejects WAIT", () => {
    expect(evaluateQualificationCandidate({ ...base, direction: "WAIT" }).ok).toBe(false);
  });

  it("rejects duplicates", () => {
    expect(
      evaluateQualificationCandidate({ ...base, alreadyCountedSignal: true }).ok
    ).toBe(false);
  });

  it("accepts valid BUY", () => {
    expect(evaluateQualificationCandidate(base).ok).toBe(true);
  });
});

describe("qualification state machine", () => {
  it("advances after 20 previews", () => {
    const doc = createEmptyQualificationDoc({
      uid: "u1",
      accountId: "a1",
      accountMasked: "48…10"
    });
    doc.startedAt = new Date().toISOString();
    doc.previewCount = 20;
    expect(deriveAdvancedState(doc)).toBe("CONTROLLED_DEMO_QUALIFICATION");
  });

  it("7-day gate cannot pass early", () => {
    const doc = createEmptyQualificationDoc({
      uid: "u1",
      accountId: "a1",
      accountMasked: "48…10"
    });
    doc.startedAt = new Date().toISOString();
    doc.previewCount = 20;
    doc.controlledTradeCount = 5;
    doc.firstControlledDemoTradeAt = new Date().toISOString();
    doc.safetyChecks = doc.safetyChecks.map((c) => ({
      ...c,
      ok: true,
      verifiedAt: new Date().toISOString()
    }));
    expect(deriveAdvancedState(doc)).toBe("OBSERVATION_PERIOD");
    const obs = observationProgress(doc.firstControlledDemoTradeAt);
    expect(obs.complete).toBe(false);
  });

  it("all gates -> DEMO_AUTO_READY", () => {
    const doc = createEmptyQualificationDoc({
      uid: "u1",
      accountId: "a1",
      accountMasked: "48…10"
    });
    doc.startedAt = new Date().toISOString();
    doc.previewCount = 20;
    doc.controlledTradeCount = 5;
    doc.firstControlledDemoTradeAt = new Date(
      Date.now() - (QUALIFICATION_GATES.requiredObservationDays + 1) * 86_400_000
    ).toISOString();
    doc.safetyChecks = doc.safetyChecks.map((c) => ({
      ...c,
      ok: true,
      verifiedAt: new Date().toISOString()
    }));
    expect(deriveAdvancedState(doc)).toBe("DEMO_AUTO_READY");
  });

  it("DEMO_AUTO_READY does not imply Demo Auto enabled", () => {
    const doc = createEmptyQualificationDoc({
      uid: "u1",
      accountId: "a1",
      accountMasked: "48…10"
    });
    doc.startedAt = new Date().toISOString();
    doc.previewCount = 20;
    doc.controlledTradeCount = 5;
    doc.firstControlledDemoTradeAt = new Date(
      Date.now() - 10 * 86_400_000
    ).toISOString();
    doc.safetyChecks = doc.safetyChecks.map((c) => ({ ...c, ok: true, verifiedAt: new Date().toISOString() }));
    const view = toPublicView({ doc, setup: readySetup });
    expect(view.state).toBe("DEMO_AUTO_READY");
    expect(view.canEnableDemoAuto).toBe(true);
    expect(view.demoAuto.enabled).toBe(false);
    expect(view.liveOrders).toBe("LOCKED");
  });

  it("20 Demo Auto trades + 7 days -> LIVE_AUTO_ELIGIBLE", () => {
    const doc = createEmptyQualificationDoc({
      uid: "u1",
      accountId: "a1",
      accountMasked: "48…10"
    });
    doc.state = "LIVE_QUALIFICATION";
    doc.demoAutoEnabledAt = new Date().toISOString();
    doc.demoAutoTradeCount = 20;
    doc.firstDemoAutoTradeAt = new Date(Date.now() - 10 * 86_400_000).toISOString();
    doc.criticalSafetyFailures = 0;
    doc.safetyChecks = doc.safetyChecks.map((c) => ({ ...c, ok: true, verifiedAt: new Date().toISOString() }));
    expect(deriveAdvancedState(doc)).toBe("LIVE_AUTO_ELIGIBLE");
    expect(allowsDemoOrderSubmission("LIVE_AUTO_ELIGIBLE")).toBe(false);
  });

  it("only controlled/demo-auto states allow Demo orders", () => {
    expect(allowsDemoOrderSubmission("PREVIEW_QUALIFICATION")).toBe(false);
    expect(allowsDemoOrderSubmission("DEMO_AUTO_READY")).toBe(false);
    expect(allowsDemoOrderSubmission("CONTROLLED_DEMO_QUALIFICATION")).toBe(true);
    expect(allowsDemoOrderSubmission("DEMO_AUTO_ENABLED")).toBe(true);
  });
});
