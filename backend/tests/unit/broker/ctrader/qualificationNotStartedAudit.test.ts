import { beforeEach, describe, expect, it, vi } from "vitest";

const { appendEvaluation, submitDemoMarketOrder, clearArmedCandidate } = vi.hoisted(() => ({
  appendEvaluation: vi.fn(async (row: Record<string, unknown>) => ({
    id: "ev_1",
    ...row
  })),
  submitDemoMarketOrder: vi.fn(),
  clearArmedCandidate: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/evaluationLogStore", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/services/broker/ctrader/evaluationLogStore")
  >("../../../../src/services/broker/ctrader/evaluationLogStore");
  return { ...actual, appendEvaluation };
});

vi.mock("../../../../src/services/broker/ctrader/demoOrderExecution", () => ({
  submitDemoMarketOrder
}));

vi.mock("../../../../src/services/broker/ctrader/armedCandidateStore", () => ({
  clearArmedCandidate,
  getArmedCandidate: vi.fn(async () => null),
  saveArmedCandidate: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/qualificationStore", () => ({
  getQualificationDoc: vi.fn(async () => ({
    uid: "u1",
    accountId: "48014710",
    accountMasked: "48…10",
    startedAt: null,
    state: "READY_TO_QUALIFY",
    safetyChecks: [],
    previews: [],
    controlledTrades: [],
    demoAutoTrades: [],
    previewCount: 0,
    controlledTradeCount: 0,
    demoAutoTradeCount: 0
  })),
  getActiveQualificationAccountId: vi.fn(async () => "48014710"),
  appendTransition: vi.fn(async (doc: unknown) => doc),
  saveQualificationDoc: vi.fn(),
  createEmptyQualificationDoc: vi.fn(),
  tryAddPreview: vi.fn(),
  recountControlled: vi.fn(),
  recountDemoAuto: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection: vi.fn(async () => ({
    selectedAccountId: "48014710",
    selectedAccountIsLive: false,
    selectedAccountMasked: "48…10",
    oauthScope: "trading",
    brokerConfirmedPepperstone: true,
    symbolId: "41",
    symbolName: "XAUUSD",
    environment: "DEMO"
  }))
}));

vi.mock("../../../../src/services/broker/ctrader/userAutoTradeSettings", () => ({
  getUserAutoTradeSettings: vi.fn(async () => ({
    uid: "u1",
    environment: "demo",
    autoTradeEnabledIntent: true,
    autoTradePaused: false,
    emergencyStopActive: false,
    selectedAccountId: "48014710",
    fixedRiskAmount: 50,
    maxDailyLoss: 250,
    maxTradesPerDay: 6,
    maxOpenPositions: 1,
    minConfidence: 80,
    minRiskReward: 1.5,
    maxSpread: 2,
    maxQuoteAgeSeconds: 15,
    allowedSessions: ["London", "NewYork"]
  })),
  saveUserAutoTradeSettings: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/connectionService", () => ({
  buildDiagnostics: vi.fn(),
  ensureFreshAccessToken: vi.fn()
}));

import { processDecisionForQualification } from "../../../../src/services/broker/ctrader/qualificationService";

describe("QUALIFICATION_NOT_STARTED audit", () => {
  beforeEach(() => {
    appendEvaluation.mockClear();
    submitDemoMarketOrder.mockClear();
  });

  it("does not submit and records audit for actionable BUY when startedAt is null", async () => {
    const store = {
      getDecision: vi.fn(async () => ({
        decision: "BUY",
        setupScore: 91,
        confidence: 91,
        entry: { price: 3400 },
        stopLoss: { price: 3390 },
        takeProfits: [{ price: 3420 }]
      })),
      getActiveSessionPlan: vi.fn(async () => null)
    };

    const result = await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_buy_91",
      store: store as never
    });

    expect(result).toEqual({ handled: false, message: "not_started" });
    expect(submitDemoMarketOrder).not.toHaveBeenCalled();
    expect(appendEvaluation).toHaveBeenCalledTimes(1);
    const row = appendEvaluation.mock.calls[0]![0] as {
      reasonCode: string;
      direction: string;
      confidence: number;
      outcome: string;
      pipeline: { brokerSubmissionAttempted: boolean };
    };
    expect(row.reasonCode).toBe("QUALIFICATION_NOT_STARTED");
    expect(row.direction).toBe("BUY");
    expect(row.confidence).toBe(91);
    expect(row.outcome).toBe("REJECTED");
    expect(row.pipeline.brokerSubmissionAttempted).toBe(false);
  });

  it("WAIT does not create QUALIFICATION_NOT_STARTED audit", async () => {
    const store = {
      getDecision: vi.fn(async () => ({
        decision: "WAIT",
        setupScore: 40,
        confidence: 40,
        entry: null,
        stopLoss: null,
        takeProfits: []
      })),
      getActiveSessionPlan: vi.fn(async () => null)
    };

    const result = await processDecisionForQualification({
      uid: "u1",
      decisionId: "dec_wait",
      store: store as never
    });

    expect(result.message).toBe("not_started");
    expect(appendEvaluation).not.toHaveBeenCalled();
    expect(submitDemoMarketOrder).not.toHaveBeenCalled();
  });
});
