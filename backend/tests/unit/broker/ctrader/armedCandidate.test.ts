/**
 * AutoTrade armed-candidate lifecycle — focused tests A–H.
 * Pure engine behaviour; no UI.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createArmedCandidate,
  evaluateArmedCandidateLifecycle,
  isArmedCandidateStale,
  isEntryConfirmationReady,
  markExecutionAttempted,
  maxArmedCandidateAgeMs,
  type ArmedCandidate
} from "../../../../src/services/broker/ctrader/armedCandidate";
import {
  clearArmedCandidate,
  getArmedCandidate,
  resetArmedCandidateMemoryStore,
  saveArmedCandidate,
  useArmedCandidateMemoryStore
} from "../../../../src/services/broker/ctrader/armedCandidateStore";
import { loadDemoOpportunityConfig } from "../../../../src/services/broker/ctrader/demoOpportunityEngine";

const baseSetup = {
  direction: "SELL" as const,
  signalId: "sig-sell-1",
  planSourceKey: "plan_2026-08-10T15:00",
  entry: 3400,
  stopLoss: 3410,
  takeProfit: 3380,
  confidence: 94,
  setupScore: 86
};

function armedFrom(setup = baseSetup, uid = "u1"): ArmedCandidate {
  return createArmedCandidate({
    uid,
    ...setup,
    nowIso: "2026-08-10T15:00:00.000Z"
  });
}

describe("armed candidate lifecycle", () => {
  beforeEach(() => {
    useArmedCandidateMemoryStore(true);
    resetArmedCandidateMemoryStore();
  });

  it("TEST A — candidate persists across evaluations without confirmation", () => {
    const first = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:00:00.000Z",
      autoTradePermitted: true,
      existing: null,
      qualifiedSetup: baseSetup,
      confirmationRequired: true,
      confirmationState: "OUTSIDE_ZONE"
    });
    expect(first.action).toBe("ARM");
    expect(first.candidate?.status).toBe("ARMED");
    expect(first.reasonCode).toBe("CANDIDATE_ARMED");

    const second = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:05:00.000Z",
      autoTradePermitted: true,
      existing: first.candidate,
      qualifiedSetup: null, // next candle did not independently re-score SELL
      confirmationRequired: true,
      confirmationState: "APPROACHING_ZONE"
    });
    expect(second.action).toBe("KEEP_WAITING");
    expect(second.candidate?.candidateId).toBe(first.candidate?.candidateId);
    expect(second.candidate?.status).toBe("ARMED");
    expect(second.reasonCode).toBe("CANDIDATE_WAITING_CONFIRMATION");
  });

  it("TEST B — confirmation arrives → ready for exactly one execution", () => {
    const armed = armedFrom();
    const ready = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:10:00.000Z",
      autoTradePermitted: true,
      existing: armed,
      qualifiedSetup: null,
      confirmationRequired: true,
      confirmationState: "REJECTION_CONFIRMED"
    });
    expect(ready.action).toBe("READY_TO_EXECUTE");
    expect(ready.reasonCode).toBe("ENTRY_CONFIRMATION_RECEIVED");
    expect(ready.candidate?.direction).toBe("SELL");
    expect(ready.candidate?.executionAttempted).toBe(false);

    const after = markExecutionAttempted(ready.candidate!, "2026-08-10T15:10:01.000Z");
    expect(after.executionAttempted).toBe(true);
    expect(after.status).toBe("ARMED");
  });

  it("TEST C — no duplicate order while confirmation stays true", () => {
    const armed = armedFrom();
    const first = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:10:00.000Z",
      autoTradePermitted: true,
      existing: armed,
      qualifiedSetup: null,
      confirmationRequired: true,
      confirmationState: "REJECTION_CONFIRMED"
    });
    expect(first.action).toBe("READY_TO_EXECUTE");
    const attempted = markExecutionAttempted(first.candidate!, "2026-08-10T15:10:01.000Z");

    const second = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:15:00.000Z",
      autoTradePermitted: true,
      existing: attempted,
      qualifiedSetup: baseSetup,
      confirmationRequired: true,
      confirmationState: "REJECTION_CONFIRMED"
    });
    expect(second.action).toBe("KEEP_WAITING");
    expect(second.reasonCode).toBe("EXECUTION_ALREADY_ATTEMPTED");
    expect(second.candidate?.executionAttempted).toBe(true);
  });

  it("TEST D — candidate invalidated when thesis becomes structurally invalid", () => {
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "sig-buy-1",
      planSourceKey: "plan_buy",
      entry: 3390,
      stopLoss: 3380,
      takeProfit: 3410,
      confidence: 95,
      setupScore: 82,
      nowIso: "2026-08-10T15:00:00.000Z"
    });
    const result = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:08:00.000Z",
      autoTradePermitted: true,
      existing: armed,
      qualifiedSetup: null,
      confirmationRequired: true,
      confirmationState: "OUTSIDE_ZONE",
      structurallyInvalid: true,
      structuralReason: "SESSION_PLAN_INVALIDATED"
    });
    expect(result.action).toBe("INVALIDATE");
    expect(result.candidate?.status).toBe("INVALIDATED");
    expect(result.candidate?.invalidationReason).toBe("SESSION_PLAN_INVALIDATED");
  });

  it("TEST E — opposite setup cancels prior armed candidate", () => {
    const buyArmed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "sig-buy-1",
      planSourceKey: "plan_buy",
      entry: 3390,
      stopLoss: 3380,
      takeProfit: 3410,
      confidence: 95,
      setupScore: 82,
      nowIso: "2026-08-10T15:00:00.000Z"
    });
    const result = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:12:00.000Z",
      autoTradePermitted: true,
      existing: buyArmed,
      qualifiedSetup: baseSetup, // SELL
      confirmationRequired: true,
      confirmationState: "OUTSIDE_ZONE"
    });
    expect(result.action).toBe("REPLACE_WITH_OPPOSITE");
    expect(result.cancelled?.direction).toBe("BUY");
    expect(result.cancelled?.status).toBe("INVALIDATED");
    expect(result.candidate?.direction).toBe("SELL");
    expect(result.candidate?.status).toBe("ARMED");
  });

  it("TEST F — risk gate still blocks; armed must not imply permission", () => {
    // Lifecycle only signals READY — caller must still run risk gates.
    const armed = armedFrom();
    const ready = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:10:00.000Z",
      autoTradePermitted: true,
      existing: armed,
      qualifiedSetup: null,
      confirmationRequired: true,
      confirmationState: "REJECTION_CONFIRMED"
    });
    expect(ready.action).toBe("READY_TO_EXECUTE");
    expect(ready.candidate?.executionAttempted).toBe(false);
    // Simulate risk rejection: candidate remains ARMED, no markExecutionAttempted.
    expect(ready.candidate?.status).toBe("ARMED");
  });

  it("TEST G — AutoTrade OFF cancels armed candidate and blocks execution", () => {
    const armed = armedFrom();
    const result = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:10:00.000Z",
      autoTradePermitted: false,
      autoTradeOffReason: "AUTOTRADE_PAUSED",
      existing: armed,
      qualifiedSetup: null,
      confirmationRequired: true,
      confirmationState: "REJECTION_CONFIRMED"
    });
    expect(result.action).toBe("INVALIDATE");
    expect(result.reasonCode).toBe("CANDIDATE_INVALIDATED_AUTOTRADE_OFF");
    expect(result.candidate?.status).toBe("INVALIDATED");
  });

  it("stale / new-session: armed candidate beyond setup entry window is invalidated", () => {
    const armed = armedFrom();
    const maxAge = maxArmedCandidateAgeMs();
    expect(maxAge).toBeGreaterThan(0);
    const later = new Date(Date.parse(armed.armedAt) + maxAge + 60_000).toISOString();
    expect(
      isArmedCandidateStale({ armedAt: armed.armedAt, nowIso: later })
    ).toBe(true);
    const result = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: later,
      autoTradePermitted: true,
      existing: armed,
      qualifiedSetup: null,
      confirmationRequired: true,
      confirmationState: "REJECTION_CONFIRMED"
    });
    expect(result.action).toBe("INVALIDATE");
    expect(result.reasonCode).toBe("CANDIDATE_INVALIDATED_STALE");
    expect(result.candidate?.status).toBe("INVALIDATED");
  });

  it("ACTIVE_DEMO: session-plan validUntil alone does NOT invalidate armed candidate", () => {
    const armed = armedFrom();
    const result = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:10:00.000Z",
      autoTradePermitted: true,
      existing: armed,
      qualifiedSetup: null,
      confirmationRequired: true,
      confirmationState: "OUTSIDE_ZONE",
      sessionPlanValidUntil: "2026-08-10T15:05:00.000Z"
    });
    expect(result.action).toBe("KEEP_WAITING");
    expect(result.candidate?.status).toBe("ARMED");
  });

  it("ACTIVE_DEMO: NO_VALID_PLAN refresh keeps armed (PLAN_REFRESH_UNAVAILABLE)", () => {
    const armed = armedFrom();
    const result = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:08:00.000Z",
      autoTradePermitted: true,
      existing: armed,
      qualifiedSetup: null,
      confirmationRequired: true,
      confirmationState: "OUTSIDE_ZONE",
      planRefreshUnavailable: true,
      structurallyInvalid: false
    });
    expect(result.action).toBe("KEEP_WAITING");
    expect(result.candidate?.status).toBe("ARMED");
    expect(result.candidate?.planRefreshNote).toBe("PLAN_REFRESH_UNAVAILABLE");
  });

  it("ACTIVE_DEMO: opposite meaningful confirmation invalidates", () => {
    const buyArmed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "sig-buy-1",
      planSourceKey: "plan_buy",
      entry: 3390,
      stopLoss: 3380,
      takeProfit: 3410,
      confidence: 95,
      setupScore: 92,
      nowIso: "2026-08-10T15:00:00.000Z"
    });
    const result = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:08:00.000Z",
      autoTradePermitted: true,
      existing: buyArmed,
      qualifiedSetup: null,
      confirmationRequired: true,
      confirmationState: "REJECTION_CONFIRMED" // bearish — invalidates BUY
    });
    expect(result.action).toBe("INVALIDATE");
    expect(result.candidate?.status).toBe("INVALIDATED");
  });

  it("A+ directional decision evidence → fast-ready; structural-only → ARMED", () => {
    const aPlusDirectional = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:00:00.000Z",
      autoTradePermitted: true,
      existing: null,
      qualifiedSetup: {
        direction: "BUY",
        signalId: "sig-aplus",
        planSourceKey: "plan_aplus",
        entry: 3400,
        stopLoss: 3390,
        takeProfit: 3415,
        takeProfit2: 3425,
        confidence: 94,
        setupScore: 94,
        originalReasons: ["MTF_BULLISH", "MARKET_STRUCTURE"]
      },
      confirmationRequired: true,
      confirmationState: "OUTSIDE_ZONE",
      candleClassification: "OUTSIDE_ZONE",
      allowFastConfirmation: true,
      decisionReasons: ["MTF_BULLISH", "MARKET_STRUCTURE"]
    });
    expect(aPlusDirectional.action).toBe("READY_TO_EXECUTE");
    expect(aPlusDirectional.reasonCode).toBe("FAST_CONFIRMATION_RECEIVED");

    const aPlusStructureOnly = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:00:00.000Z",
      autoTradePermitted: true,
      existing: null,
      qualifiedSetup: {
        direction: "BUY",
        signalId: "sig-aplus-struct",
        planSourceKey: "plan_struct",
        entry: 3400,
        stopLoss: 3390,
        takeProfit: 3415,
        confidence: 94,
        setupScore: 94,
        originalReasons: ["TREND_AGREEMENT", "POC"]
      },
      confirmationRequired: true,
      confirmationState: "OUTSIDE_ZONE",
      candleClassification: "OUTSIDE_ZONE",
      allowFastConfirmation: false,
      decisionReasons: ["TREND_AGREEMENT", "POC"]
    });
    expect(aPlusStructureOnly.action).toBe("ARM");
    expect(aPlusStructureOnly.candidate?.status).toBe("ARMED");
  });

  it("A with same directional evidence waits for normal confirmation (no fast path)", () => {
    const aWait = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:00:00.000Z",
      autoTradePermitted: true,
      existing: null,
      qualifiedSetup: {
        direction: "BUY",
        signalId: "sig-a",
        planSourceKey: "plan_a",
        entry: 3400,
        stopLoss: 3390,
        takeProfit: 3415,
        confidence: 86,
        setupScore: 86,
        originalReasons: ["MTF_BULLISH", "MARKET_STRUCTURE"]
      },
      confirmationRequired: true,
      confirmationState: "OUTSIDE_ZONE",
      candleClassification: "OUTSIDE_ZONE",
      allowFastConfirmation: false,
      decisionReasons: ["MTF_BULLISH", "MARKET_STRUCTURE"]
    });
    expect(aWait.action).toBe("ARM");
    expect(aWait.reasonCode).toBe("CANDIDATE_ARMED");
  });

  it("BELOW opposite setup cannot replace an existing A/A+ armed candidate", () => {
    const armed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "sig-buy-a",
      planSourceKey: "plan_buy",
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      confidence: 92,
      setupScore: 92,
      nowIso: "2026-08-10T15:00:00.000Z"
    });
    const result = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:05:00.000Z",
      autoTradePermitted: true,
      existing: armed,
      qualifiedSetup: {
        direction: "SELL",
        signalId: "sig-below-sell",
        planSourceKey: "plan_below",
        entry: 3400,
        stopLoss: 3410,
        takeProfit: 3380,
        confidence: 88,
        setupScore: 78
      },
      confirmationRequired: true,
      confirmationState: "OUTSIDE_ZONE"
    });
    expect(result.action).toBe("KEEP_WAITING");
    expect(result.reasonCode).toBe("TIER_BELOW_A_IGNORED");
    expect(result.candidate?.direction).toBe("BUY");
    expect(result.candidate?.status).toBe("ARMED");
  });

  it("configured armed window: bars=3 → 15m expiry; bars=6 → 30m", () => {
    const cfg3 = loadDemoOpportunityConfig({
      DEMO_ARMED_CONFIRMATION_BARS_5M: "3"
    } as NodeJS.ProcessEnv);
    const cfg6 = loadDemoOpportunityConfig({
      DEMO_ARMED_CONFIRMATION_BARS_5M: "6"
    } as NodeJS.ProcessEnv);
    const a3 = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "sig-w3",
      planSourceKey: null,
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      confidence: 90,
      setupScore: 90,
      nowIso: "2026-08-10T15:00:00.000Z",
      opportunityConfig: cfg3
    });
    const a6 = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "sig-w6",
      planSourceKey: null,
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      confidence: 90,
      setupScore: 90,
      nowIso: "2026-08-10T15:00:00.000Z",
      opportunityConfig: cfg6
    });
    expect(a3.expiresAt).toBe("2026-08-10T15:15:00.000Z");
    expect(a6.expiresAt).toBe("2026-08-10T15:30:00.000Z");
  });

  it("BUY invalidation uses bid breach of stop", () => {
    const buyArmed = createArmedCandidate({
      uid: "u1",
      direction: "BUY",
      signalId: "sig-buy-stop",
      planSourceKey: "plan_buy",
      entry: 3400,
      stopLoss: 3390,
      takeProfit: 3415,
      confidence: 92,
      setupScore: 92,
      nowIso: "2026-08-10T15:00:00.000Z"
    });
    const hit = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:05:00.000Z",
      autoTradePermitted: true,
      existing: buyArmed,
      qualifiedSetup: null,
      confirmationRequired: true,
      confirmationState: "OUTSIDE_ZONE",
      markPrice: 3389.5 // bid through stop
    });
    expect(hit.action).toBe("INVALIDATE");
    expect(hit.candidate?.invalidationReason).toBe("INVALIDATION_PRICE_BREACHED");
  });

  it("TEST H — low-quality WAIT setups are never armed", () => {
    const result = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:00:00.000Z",
      autoTradePermitted: true,
      existing: null,
      qualifiedSetup: null,
      confirmationRequired: true,
      confirmationState: "NONE"
    });
    expect(result.action).toBe("NONE");
    expect(result.candidate).toBeNull();
    expect(result.reasonCode).toBe("NO_CANDIDATE");
  });

  it("uses existing confirmation authority for SELL rejection / BUY breakout", () => {
    expect(
      isEntryConfirmationReady({
        confirmationRequired: true,
        direction: "SELL",
        confirmationState: "REJECTION_CONFIRMED"
      })
    ).toBe(true);
    expect(
      isEntryConfirmationReady({
        confirmationRequired: true,
        direction: "BUY",
        confirmationState: "BREAKOUT_CONFIRMED"
      })
    ).toBe(true);
    expect(
      isEntryConfirmationReady({
        confirmationRequired: true,
        direction: "SELL",
        confirmationState: "OUTSIDE_ZONE"
      })
    ).toBe(false);
    expect(
      isEntryConfirmationReady({
        confirmationRequired: false,
        direction: "SELL",
        confirmationState: "OUTSIDE_ZONE"
      })
    ).toBe(true);
  });

  it("memory store keeps a single armed candidate without duplicates", async () => {
    const a = armedFrom();
    await saveArmedCandidate(a);
    await saveArmedCandidate({ ...a, updatedAt: "2026-08-10T15:05:00.000Z" });
    const got = await getArmedCandidate("u1");
    expect(got?.candidateId).toBe(a.candidateId);
    expect(got?.updatedAt).toBe("2026-08-10T15:05:00.000Z");
    await clearArmedCandidate("u1");
    expect(await getArmedCandidate("u1")).toBeNull();
  });

  it("same setup re-evaluation does not create a new candidate id", () => {
    const first = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:00:00.000Z",
      autoTradePermitted: true,
      existing: null,
      qualifiedSetup: baseSetup,
      confirmationRequired: true,
      confirmationState: "NONE"
    });
    const again = evaluateArmedCandidateLifecycle({
      uid: "u1",
      nowIso: "2026-08-10T15:05:00.000Z",
      autoTradePermitted: true,
      existing: first.candidate,
      qualifiedSetup: { ...baseSetup, signalId: "sig-sell-1-reeval" },
      confirmationRequired: true,
      confirmationState: "NONE"
    });
    expect(again.action).toBe("KEEP_WAITING");
    expect(again.candidate?.candidateId).toBe(first.candidate?.candidateId);
  });
});
