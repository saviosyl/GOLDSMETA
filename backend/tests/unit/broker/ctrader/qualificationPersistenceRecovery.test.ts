/**
 * Qualification / Demo Auto persistence + account-conflict guards (PR recovery).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getQualificationDoc,
  getActiveQualificationAccountId,
  findForeignStartedQualifications,
  saveQualificationDoc,
  createEmptyQualificationDoc,
  appendTransition,
  getConnection,
  getUserAutoTradeSettings,
  countEvaluationsForDay,
  listRecentEvaluations,
  claimDemoQualificationOwnership,
  backfillOwnershipFromStartedQualification
} = vi.hoisted(() => ({
  getQualificationDoc: vi.fn(),
  getActiveQualificationAccountId: vi.fn(),
  findForeignStartedQualifications: vi.fn(),
  saveQualificationDoc: vi.fn(),
  createEmptyQualificationDoc: vi.fn(),
  appendTransition: vi.fn(),
  getConnection: vi.fn(),
  getUserAutoTradeSettings: vi.fn(),
  countEvaluationsForDay: vi.fn(),
  listRecentEvaluations: vi.fn(),
  claimDemoQualificationOwnership: vi.fn(),
  backfillOwnershipFromStartedQualification: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/qualificationStore", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/services/broker/ctrader/qualificationStore")
  >("../../../../src/services/broker/ctrader/qualificationStore");
  return {
    ...actual,
    getQualificationDoc,
    getActiveQualificationAccountId,
    findForeignStartedQualifications,
    saveQualificationDoc,
    createEmptyQualificationDoc,
    appendTransition
  };
});

vi.mock("../../../../src/services/broker/ctrader/qualificationOwnership", () => ({
  claimDemoQualificationOwnership,
  backfillOwnershipFromStartedQualification,
  getQualificationOwnershipClaim: vi.fn(),
  qualificationOwnerDocId: (id: string) => `hash-${id}`
}));

vi.mock("../../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection
}));

vi.mock("../../../../src/services/broker/ctrader/userAutoTradeSettings", () => ({
  getUserAutoTradeSettings,
  saveUserAutoTradeSettings: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/evaluationLogStore", () => ({
  countEvaluationsForDay,
  listRecentEvaluations,
  appendEvaluation: vi.fn(),
  reasonLabelFor: (c: string) => c
}));

vi.mock("../../../../src/services/broker/ctrader/flags", () => ({
  isCTraderLiveEnabled: () => false,
  isCTraderDemoOrderSubmissionEnabled: () => true
}));

vi.mock("../../../../src/services/broker/ctrader/demoAutoExecutionAuthority", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/services/broker/ctrader/demoAutoExecutionAuthority")
  >("../../../../src/services/broker/ctrader/demoAutoExecutionAuthority");
  return {
    ...actual,
    resolveDemoAutoAuthorityForUser: vi.fn()
  };
});

import {
  normalizeAccountId
} from "../../../../src/services/broker/ctrader/qualificationStore";
import {
  getQualificationView,
  startQualification
} from "../../../../src/services/broker/ctrader/qualificationService";
import {
  executionNowLabelFor,
  evaluateDemoAutoExecutionAuthority,
  toDemoAutoAuthorityApi
} from "../../../../src/services/broker/ctrader/demoAutoExecutionAuthority";
import {
  buildAuthoritativeQuote,
  refreshAuthoritativeFreshness
} from "../../../../src/services/broker/ctrader/liveQuote";

const OWNER = "owner-uid";
const ACCOUNT = "48014710";

function liveQualDoc(overrides: Record<string, unknown> = {}) {
  return {
    uid: OWNER,
    accountId: ACCOUNT,
    accountMasked: "48…10",
    environment: "DEMO",
    state: "LIVE_QUALIFICATION",
    pausedFrom: null,
    startedAt: "2026-08-08T21:02:29.619Z",
    updatedAt: "2026-08-12T13:05:33.611Z",
    previewCount: 1,
    previewSignalIds: ["x"],
    previews: [],
    controlledTradeCount: 0,
    controlledBlockedAttempts: 0,
    controlledOpenCount: 0,
    controlledTrades: [],
    firstControlledDemoTradeAt: null,
    demoAutoEnabledAt: "2026-08-10T16:41:23.951Z",
    firstDemoAutoTradeAt: "2026-08-10T18:32:05.970Z",
    demoAutoTradeCount: 1,
    demoAutoTrades: [],
    criticalSafetyFailures: 0,
    safetyChecks: [],
    transitions: [],
    lastError: null,
    buildSha: "abc",
    ...overrides
  };
}

function demoConnection(accountId: string | number = ACCOUNT) {
  return {
    ownerUid: OWNER,
    environment: "DEMO",
    selectedAccountId: accountId,
    selectedAccountIsLive: false,
    selectedAccountMasked: "48…10",
    oauthScope: "trading",
    symbolId: "41",
    symbolName: "XAUUSD",
    lastQuoteAt: new Date().toISOString(),
    disconnectedAt: null
  };
}

function demoSettings(intent = true) {
  return {
    uid: OWNER,
    environment: "demo",
    autoTradeEnabledIntent: intent,
    autoTradePaused: false,
    emergencyStopActive: false,
    fixedRiskAmount: 50,
    maxDailyLoss: 200,
    maxTradesPerDay: 5,
    minConfidence: 80,
    selectedAccountId: ACCOUNT,
    demoProfitLockLadderEnabled: true,
    maxQuoteAgeSeconds: 15
  };
}

describe("qualification persistence + conflict recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnection.mockResolvedValue(demoConnection());
    getUserAutoTradeSettings.mockResolvedValue(demoSettings(true));
    getActiveQualificationAccountId.mockResolvedValue(ACCOUNT);
    findForeignStartedQualifications.mockResolvedValue({ ok: true, hits: [] });
    claimDemoQualificationOwnership.mockResolvedValue({
      ok: true,
      claimed: true,
      ownerUid: OWNER
    });
    backfillOwnershipFromStartedQualification.mockResolvedValue({
      ok: true,
      claimed: false,
      ownerUid: OWNER
    });
    countEvaluationsForDay.mockResolvedValue({
      evaluated: 0,
      qualified: 0,
      rejected: 0
    });
    listRecentEvaluations.mockResolvedValue([]);
    saveQualificationDoc.mockResolvedValue(undefined);
    appendTransition.mockImplementation(async (doc: { state?: string }, to: string) => ({
      ...doc,
      state: to
    }));
  });

  it("A/E: LIVE_QUALIFICATION persists and is returned (not READY_TO_QUALIFY)", async () => {
    getQualificationDoc.mockResolvedValue(liveQualDoc());
    const view = await getQualificationView(OWNER);
    expect(view.state).toBe("LIVE_QUALIFICATION");
    expect(view.startedAt).toBeTruthy();
    expect(view.recordStatus).toBe("ACTIVE");
    expect(view.overallLabel).not.toMatch(/not active/i);
    expect(saveQualificationDoc).not.toHaveBeenCalled();
  });

  it("owner active GET performs ZERO foreign collection-group lookups", async () => {
    getQualificationDoc.mockResolvedValue(liveQualDoc());
    await getQualificationView(OWNER);
    expect(findForeignStartedQualifications).not.toHaveBeenCalled();
  });

  it("B/K: Demo Auto intent remains authoritative when settings say true", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    expect(authority.demoExecutionEnabled).toBe(true);
    const api = toDemoAutoAuthorityApi({
      authority,
      qualificationState: "LIVE_QUALIFICATION",
      intentEnabled: true,
      paused: false,
      emergencyStop: false,
      demoSubmissionFlag: true,
      selectedDemoAccount: "48…10",
      tradingScope: "trading",
      quoteHealthy: true,
      startedAt: "2026-08-08T00:00:00Z"
    });
    expect(api.enabled).toBe(true);
    expect(api.submissionAuthorized).toBe(true);
  });

  it("C/D: getQualificationView does not create or save qualification docs", async () => {
    getQualificationDoc.mockResolvedValue(null);
    getActiveQualificationAccountId.mockResolvedValue(null);
    const view = await getQualificationView(OWNER);
    expect(view.recordStatus).toBe("NEVER_STARTED");
    expect(createEmptyQualificationDoc).not.toHaveBeenCalled();
    expect(saveQualificationDoc).not.toHaveBeenCalled();
  });

  it("F: selected-account mismatch does not reset foreign/local started doc to 0/20", async () => {
    getQualificationDoc.mockImplementation(async (_uid: string, accountId: string) => {
      if (accountId === "99999999") return liveQualDoc({ accountId: "99999999", accountMasked: "99…99" });
      return null;
    });
    getActiveQualificationAccountId.mockResolvedValue("99999999");
    getConnection.mockResolvedValue(demoConnection(ACCOUNT));
    const view = await getQualificationView(OWNER);
    expect(view.overallLabel).toMatch(/ACCOUNT MISMATCH/i);
    expect(view.canStart).toBe(false);
    expect(view.preview.completed).toBe(1);
    expect(saveQualificationDoc).not.toHaveBeenCalled();
    expect(findForeignStartedQualifications).not.toHaveBeenCalled();
  });

  it("G: foreign UID started qualification surfaces ACCOUNT CONFLICT (not silent 0/20)", async () => {
    getQualificationDoc.mockResolvedValue(null);
    findForeignStartedQualifications.mockResolvedValue({
      ok: true,
      hits: [
        {
          uid: "other-uid",
          accountId: ACCOUNT,
          state: "LIVE_QUALIFICATION",
          startedAt: "2026-08-08T21:02:29.619Z",
          accountMasked: "48…10"
        }
      ]
    });
    const view = await getQualificationView(OWNER);
    expect(view.recordStatus).toBe("ACCOUNT_CONFLICT");
    expect(view.overallLabel).toMatch(/ACCOUNT MISMATCH/i);
    expect(view.canStart).toBe(false);
    expect(view.preview.completed).toBe(0);
    expect(view.demoAuto.enabled).toBe(false);
  });

  it("GET lookup failure → OWNERSHIP_CHECK_UNAVAILABLE (not invented conflict, canStart false)", async () => {
    getQualificationDoc.mockResolvedValue(null);
    findForeignStartedQualifications.mockResolvedValue({
      ok: false,
      code: "QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE",
      message: "index missing"
    });
    const view = await getQualificationView(OWNER);
    expect(view.recordStatus).toBe("OWNERSHIP_CHECK_UNAVAILABLE");
    expect(view.canStart).toBe(false);
    expect(view.overallLabel).toMatch(/unavailable/i);
    expect(saveQualificationDoc).not.toHaveBeenCalled();
  });

  it("H: string/number account id normalization collapses duplicate keys", () => {
    expect(normalizeAccountId(48014710)).toBe("48014710");
    expect(normalizeAccountId("48014710")).toBe("48014710");
    expect(normalizeAccountId(" 48014710 ")).toBe("48014710");
    expect(normalizeAccountId(null)).toBeNull();
  });

  it("J: missing record vs never-started are distinguishable", async () => {
    getQualificationDoc.mockResolvedValue(null);
    getActiveQualificationAccountId.mockResolvedValue(ACCOUNT);
    const missing = await getQualificationView(OWNER);
    expect(missing.recordStatus).toBe("MISSING_RECORD");

    getActiveQualificationAccountId.mockResolvedValue(null);
    const never = await getQualificationView(OWNER);
    expect(never.recordStatus).toBe("NEVER_STARTED");
  });

  it("M: qualification NOT STARTED → authority off (zero broker mutations path)", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: null,
      autoTradeEnabledIntent: false,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    expect(authority.demoExecutionEnabled).toBe(false);
  });

  it("N: Live account → zero Demo submission authority", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: true,
      demoOrderSubmissionEnabled: true
    });
    expect(authority.demoExecutionEnabled).toBe(false);
  });

  it("O/P: stale authoritative quote blocks execution and uses consistent label", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    const api = toDemoAutoAuthorityApi({
      authority,
      qualificationState: "LIVE_QUALIFICATION",
      intentEnabled: true,
      paused: false,
      emergencyStop: false,
      demoSubmissionFlag: true,
      selectedDemoAccount: "48…10",
      tradingScope: "trading",
      quoteHealthy: false,
      quoteAgeSeconds: 180,
      marketStatus: "OPEN",
      startedAt: "2026-08-08T00:00:00Z"
    });
    expect(api.submissionAuthorized).toBe(true);
    expect(api.executionEligible).toBe(false);
    expect(api.executionNowLabel).toBe("WAITING — EXECUTION QUOTE STALE");
    expect(
      executionNowLabelFor({
        submissionAuthorized: true,
        executionEligible: false,
        marketStatus: "OPEN",
        quoteHealthy: false,
        reasons: []
      })
    ).toBe("WAITING — EXECUTION QUOTE STALE");
  });

  it("P: read-time freshness refresh demotes persisted LIVE after age", () => {
    const q = buildAuthoritativeQuote({
      symbolId: "41",
      symbolName: "XAUUSD",
      bid: 1,
      ask: 1.1,
      brokerTimestamp: new Date(Date.now() - 180_000).toISOString(),
      quoteSequence: 1,
      marketStatus: "OPEN",
      environment: "DEMO",
      nowMs: Date.now() - 180_000
    });
    expect(q.freshness).toBe("LIVE");
    const refreshed = refreshAuthoritativeFreshness(q, Date.now());
    expect(refreshed.freshness).toBe("STALE");
    expect(refreshed.executable).toBe(false);
  });

  it("startQualification refuses foreign started qualification (no silent 0/20)", async () => {
    findForeignStartedQualifications.mockResolvedValue({
      ok: true,
      hits: [
        {
          uid: "other",
          accountId: ACCOUNT,
          state: "LIVE_QUALIFICATION",
          startedAt: "2026-08-08T00:00:00Z",
          accountMasked: "48…10"
        }
      ]
    });
    await expect(startQualification(OWNER)).rejects.toMatchObject({
      code: "QUALIFICATION_ACCOUNT_MISMATCH"
    });
    expect(saveQualificationDoc).not.toHaveBeenCalled();
    expect(claimDemoQualificationOwnership).not.toHaveBeenCalled();
  });

  it("startQualification lookup failure fails CLOSED — zero qual create", async () => {
    findForeignStartedQualifications.mockResolvedValue({
      ok: false,
      code: "QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE",
      message: "firestore unavailable"
    });
    await expect(startQualification(OWNER)).rejects.toMatchObject({
      code: "QUALIFICATION_OWNERSHIP_CHECK_UNAVAILABLE"
    });
    expect(saveQualificationDoc).not.toHaveBeenCalled();
    expect(createEmptyQualificationDoc).not.toHaveBeenCalled();
    expect(claimDemoQualificationOwnership).not.toHaveBeenCalled();
  });

  it("startQualification claim mismatch fails CLOSED — zero qual create", async () => {
    claimDemoQualificationOwnership.mockResolvedValue({
      ok: false,
      code: "QUALIFICATION_ACCOUNT_MISMATCH",
      message: "claimed by other"
    });
    await expect(startQualification(OWNER)).rejects.toMatchObject({
      code: "QUALIFICATION_ACCOUNT_MISMATCH"
    });
    expect(saveQualificationDoc).not.toHaveBeenCalled();
  });

  it("Live account cannot start Demo qualification", async () => {
    getConnection.mockResolvedValue({
      ...demoConnection(),
      selectedAccountIsLive: true,
      environment: "LIVE"
    });
    await expect(startQualification(OWNER)).rejects.toMatchObject({
      // Live selection fails setup readiness / Demo-account gate before any write.
      code: expect.stringMatching(/QUALIFICATION_NOT_READY|CTRADER_DEMO_ACCOUNT_REQUIRED/)
    });
    expect(findForeignStartedQualifications).not.toHaveBeenCalled();
    expect(saveQualificationDoc).not.toHaveBeenCalled();
    expect(claimDemoQualificationOwnership).not.toHaveBeenCalled();
  });
});
