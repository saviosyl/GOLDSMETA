import { beforeEach, describe, expect, it, vi } from "vitest";

const getConnection = vi.fn();
const getQualificationDoc = vi.fn();
const saveQualificationDoc = vi.fn();
const getActiveQualificationAccountId = vi.fn();
const markTradeClosed = vi.fn();
const updateAutoTradeJournalOnClose = vi.fn();
const createAutoTradeJournalEntry = vi.fn();
const buildDiagnostics = vi.fn();
const getUserAutoTradeSettings = vi.fn();

vi.mock("../../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection: (...a: unknown[]) => getConnection(...a)
}));
vi.mock("../../../../src/services/broker/ctrader/connectionService", () => ({
  buildDiagnostics: (...a: unknown[]) => buildDiagnostics(...a)
}));
vi.mock("../../../../src/services/broker/ctrader/qualificationStore", () => ({
  getQualificationDoc: (...a: unknown[]) => getQualificationDoc(...a),
  saveQualificationDoc: (...a: unknown[]) => saveQualificationDoc(...a),
  getActiveQualificationAccountId: (...a: unknown[]) =>
    getActiveQualificationAccountId(...a),
  recountControlled: (d: { controlledTrades: Array<{ counted: boolean }> }) => ({
    ...d,
    controlledTradeCount: d.controlledTrades.filter((t) => t.counted).length
  }),
  recountDemoAuto: (d: {
    demoAutoTrades: Array<{ counted: boolean }>;
    demoAutoTradeCount?: number;
  }) => ({
    ...d,
    demoAutoTradeCount: d.demoAutoTrades.filter((t) => t.counted).length
  }),
  appendTransition: async (d: unknown, to: string) => ({ ...(d as object), state: to }),
  createEmptyQualificationDoc: vi.fn(),
  tryAddPreview: vi.fn()
}));
vi.mock("../../../../src/services/broker/ctrader/dailySafetyService", () => ({
  assertEntryAllowed: vi.fn(),
  markTradeClosed: (...a: unknown[]) => markTradeClosed(...a),
  markTradeOpened: vi.fn()
}));
vi.mock("../../../../src/services/broker/ctrader/autoTradeJournal", () => ({
  updateAutoTradeJournalOnClose: (...a: unknown[]) =>
    updateAutoTradeJournalOnClose(...a),
  createAutoTradeJournalEntry: (...a: unknown[]) => createAutoTradeJournalEntry(...a)
}));
vi.mock("../../../../src/services/broker/ctrader/userAutoTradeSettings", () => ({
  getUserAutoTradeSettings: (...a: unknown[]) => getUserAutoTradeSettings(...a),
  saveUserAutoTradeSettings: vi.fn()
}));
vi.mock("../../../../src/services/broker/ctrader/qualificationMachine", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/services/broker/ctrader/qualificationMachine")
  >("../../../../src/services/broker/ctrader/qualificationMachine");
  return {
    ...actual,
    toPublicView: vi.fn(() => ({
      state: "DEMO_AUTO_ENABLED",
      canBeginLiveActivation: false,
      blockers: []
    })),
    deriveAdvancedState: (d: { state: string }) => d.state,
    buildSetupBlockers: () => [],
    setupReady: () => true
  };
});
vi.mock("../../../../src/services/broker/ctrader/evaluationLogStore", () => ({
  appendEvaluation: vi.fn(),
  countEvaluationsForDay: vi.fn(async () => ({})),
  listRecentEvaluations: vi.fn(async () => []),
  reasonLabelFor: (x: string) => x
}));
vi.mock("../../../../src/services/broker/ctrader/liveNewsGate", () => ({
  newsProtectionBlocksLiveActivation: () => ({ blocked: false })
}));
vi.mock("../../../../src/services/broker/ctrader/flags", () => ({
  isCTraderDemoOrderSubmissionEnabled: () => true,
  isCTraderLiveEnabled: () => false
}));
vi.mock("../../../../src/services/broker/ctrader/demoOrderExecution", () => ({
  submitDemoMarketOrder: vi.fn()
}));
vi.mock("../../../../src/services/broker/ctrader/demoPositionLifecycle", () => ({
  createDemoPositionLifecycle: vi.fn()
}));
vi.mock("../../../../src/services/broker/ctrader/armedCandidateStore", () => ({
  clearArmedCandidate: vi.fn(),
  getArmedCandidate: vi.fn(),
  saveArmedCandidate: vi.fn()
}));
vi.mock("../../../../src/services/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

import { markQualificationTradeClosed } from "../../../../src/services/broker/ctrader/qualificationService";

describe("markQualificationTradeClosed repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnection.mockResolvedValue({
      selectedAccountId: "48014710",
      selectedAccountMasked: "48…10",
      selectedAccountIsLive: false,
      brokerConfirmedPepperstone: true,
      oauthScope: "trading",
      symbolId: "41"
    });
    getActiveQualificationAccountId.mockResolvedValue("48014710");
    buildDiagnostics.mockResolvedValue({
      account: { currency: "EUR" },
      symbol: null
    });
    getUserAutoTradeSettings.mockResolvedValue({
      fixedRiskAmount: 300,
      maxDailyLoss: 1000,
      maxTradesPerDay: 20,
      minConfidence: 60,
      autoTradePaused: false,
      emergencyStopActive: false,
      newsFilterEnabled: false,
      newsImpactMode: "OFF"
    });
    updateAutoTradeJournalOnClose.mockResolvedValue({ updated: true });
    markTradeClosed.mockResolvedValue(undefined);
    saveQualificationDoc.mockResolvedValue(undefined);
  });

  it("F/K: OPEN → CLOSED with pnl counts demoAutoTradeCount once", async () => {
    getQualificationDoc.mockResolvedValue({
      uid: "uid",
      accountId: "48014710",
      accountMasked: "48…10",
      state: "DEMO_AUTO_ENABLED",
      controlledTrades: [],
      demoAutoTrades: [
        {
          id: "t1",
          correlationId: "corr_x",
          signalId: "sig",
          at: "2026-08-10T18:32:05.000Z",
          closedAt: null,
          direction: "BUY",
          status: "OPEN",
          pnl: null,
          counted: false,
          brokerPositionId: "53870324"
        }
      ],
      demoAutoTradeCount: 0,
      transitions: [],
      safetyChecks: []
    });

    await markQualificationTradeClosed({
      uid: "uid",
      correlationId: "corr_x",
      pnl: -3.71,
      closeReason: "SL",
      brokerDealId: "deal-1"
    });

    expect(saveQualificationDoc).toHaveBeenCalled();
    const saved = saveQualificationDoc.mock.calls[0][0];
    expect(saved.demoAutoTrades[0].status).toBe("CLOSED");
    expect(saved.demoAutoTrades[0].pnl).toBe(-3.71);
    expect(saved.demoAutoTrades[0].counted).toBe(true);
    expect(saved.demoAutoTradeCount).toBe(1);
    expect(markTradeClosed).toHaveBeenCalledTimes(1);
    expect(updateAutoTradeJournalOnClose).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: "corr_x",
        pnl: -3.71,
        brokerPnlConfirmed: true
      })
    );
  });

  it("L: CLOSED+null pnl repair counts once; second call does not double", async () => {
    const doc = {
      uid: "uid",
      accountId: "48014710",
      accountMasked: "48…10",
      state: "DEMO_AUTO_ENABLED",
      controlledTrades: [],
      demoAutoTrades: [
        {
          id: "t1",
          correlationId: "corr_x",
          signalId: "sig",
          at: "2026-08-10T18:32:05.000Z",
          closedAt: "2026-08-10T19:00:00.000Z",
          direction: "BUY" as const,
          status: "CLOSED" as const,
          pnl: null as number | null,
          counted: false,
          brokerPositionId: "53870324"
        }
      ],
      demoAutoTradeCount: 0,
      transitions: [],
      safetyChecks: [] as []
    };
    getQualificationDoc.mockResolvedValue(doc);
    saveQualificationDoc.mockImplementation(async (d: typeof doc) => {
      Object.assign(doc, d);
    });

    await markQualificationTradeClosed({
      uid: "uid",
      correlationId: "corr_x",
      pnl: -3.71
    });
    expect(doc.demoAutoTrades[0]!.pnl).toBe(-3.71);
    expect(doc.demoAutoTrades[0]!.counted).toBe(true);
    expect(doc.demoAutoTradeCount).toBe(1);
    expect(markTradeClosed).toHaveBeenCalledTimes(1);

    await markQualificationTradeClosed({
      uid: "uid",
      correlationId: "corr_x",
      pnl: -3.71
    });
    expect(doc.demoAutoTradeCount).toBe(1);
    // Second call still idempotent for daily safety (markTradeClosed may be skipped)
    expect(markTradeClosed).toHaveBeenCalledTimes(1);
  });
});
