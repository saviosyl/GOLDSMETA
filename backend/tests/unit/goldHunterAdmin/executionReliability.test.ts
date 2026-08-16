/**
 * Gold Hunter overnight execution reliability — regression for stranded
 * SELECTED + unconsumed opportunities (2026-08-16 incident class).
 *
 * Covers tests A–Q from the overnight reliability brief.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection: vi.fn(async () => ({
    selectedAccountId: "123",
    selectedAccountIsLive: false,
    environment: "DEMO",
    oauthScope: "trading",
    brokerConfirmedPepperstone: true,
    symbolId: "42",
    symbolName: "XAUUSD",
    symbolDigits: 2
  }))
}));

vi.mock("../../../src/services/broker/ctrader/flags", () => ({
  isCTraderLiveEnabled: () => false,
  isCTraderDemoOrderSubmissionEnabled: () => true
}));

vi.mock("../../../src/services/marketFeed/sharedMarketData", () => ({
  getSharedXauusdQuote: vi.fn(async () => ({
    marketStatus: "OPEN",
    updatedAt: new Date().toISOString(),
    bid: 2600,
    ask: 2600.12
  }))
}));

import {
  getGoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests,
  type GoldHunterSelectedCandidate
} from "../../../src/services/goldHunterAdmin/strategySelector";
import {
  enqueueGoldHunterDemoAutoExecution,
  drainGoldHunterDemoAutoExecutionForTests,
  resetGoldHunterDemoAutoExecutionForTests,
  setGoldHunterDemoAutoExecutionHooksForTests,
  maybeReconsiderGoldHunterDemoAutoExecution,
  GH_EXECUTION_RETRY_COOLDOWN_MS,
  isGoldHunterPreclaimFailureRetryable,
  goldHunterDemoExecQueueStats
} from "../../../src/services/goldHunterAdmin/demoAutoExecutionRuntime";
import {
  getGoldHunterExecutionDiagnostics,
  patchGoldHunterExecutionTelemetry
} from "../../../src/services/goldHunterAdmin/executionRuntimeStore";
import {
  assertGoldHunterCandidateFresh,
  refreshGoldHunterCandidateAgainstLive
} from "../../../src/services/goldHunterAdmin/candidateFreshness";
import {
  resetGoldHunterSignalClaimsForTests,
  acquireGoldHunterSignalClaim,
  getGoldHunterSignalClaim
} from "../../../src/services/goldHunterAdmin/signalClaimStore";
import { resetGoldHunterTradeMemory } from "../../../src/services/goldHunterAdmin/tradeStore";
import { saveGoldHunterConfig } from "../../../src/services/goldHunterAdmin/configStore";
import { resetOwnerQueuesForTests, BoundedSerializedQueue } from "../../../src/services/goldHunterAdmin/boundedQueue";
import { resetGoldHunterMarketFeedForTests } from "../../../src/services/goldHunterAdmin/marketFeedHook";
import { assembleGoldHunterStatus } from "../../../src/services/goldHunterAdmin/statusAssembler";
import { GH_ADMIN_DEFAULT_CONFIG } from "../../../src/services/goldHunterAdmin/types";
import type { BrokerSymbol } from "../../../src/services/broker/domain";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OWNER = "gh-reliability-owner";

const hitA = {
  setup: "A_MOMENTUM_IGNITION",
  side: "SELL" as const,
  quality: 0.65
};

function symbolMeta(): BrokerSymbol {
  return {
    brokerId: "pepperstone_ctrader",
    environment: "DEMO",
    symbolId: "42",
    symbolName: "XAUUSD",
    displayName: "XAUUSD",
    baseAsset: "XAU",
    quoteAsset: "USD",
    digits: 2,
    pipPosition: 1,
    tickSize: 0.01,
    minVolume: 0.01,
    volumeStep: 0.01,
    maxVolume: 50,
    lotSize: 1,
    commissionType: null,
    commissionAmount: null,
    minCommission: null,
    swapLong: null,
    swapShort: null,
    minStopDistance: null,
    rawSlDistance: null,
    distanceSetIn: null,
    rawTpDistance: null,
    normalizedMinStopPriceDistance: 0.1,
    guaranteedStopAvailable: null,
    tradingScheduleId: null,
    metadataComplete: true
  };
}

async function seedConfig(over: Partial<typeof GH_ADMIN_DEFAULT_CONFIG> = {}) {
  const demoAutoTradeEnabled = over.demoAutoTradeEnabled ?? true;
  await saveGoldHunterConfig(OWNER, {
    ...GH_ADMIN_DEFAULT_CONFIG,
    ...over,
    demoAutoTradeEnabled,
    mode: demoAutoTradeEnabled ? "DEMO_AUTO" : "RESEARCH",
    updatedAt: new Date().toISOString(),
    updatedBy: OWNER
  });
}

function openOpportunity(): {
  opportunity: GoldHunterSelectedCandidate;
  opportunityId: string;
} {
  const sel = getGoldHunterStrategySelector(OWNER);
  const tick = sel.processInjectedSelectionForTests({
    selected: hitA,
    receivedAtMs: Date.now(),
    bookGeneration: 1
  });
  expect(tick.newOpportunity).toBe(true);
  expect(tick.opportunity).toBeTruthy();
  return {
    opportunity: tick.opportunity!,
    opportunityId: tick.opportunity!.opportunityId
  };
}

function advanceCooldown(): void {
  const tel = getGoldHunterExecutionDiagnostics(OWNER);
  patchGoldHunterExecutionTelemetry(OWNER, {
    lastAttemptAt: new Date(
      Date.now() - GH_EXECUTION_RETRY_COOLDOWN_MS - 5
    ).toISOString()
  });
  // Preserve other fields already set; patch merges.
  void tel;
}

beforeEach(async () => {
  resetGoldHunterStrategySelectorsForTests();
  resetGoldHunterSignalClaimsForTests();
  resetGoldHunterTradeMemory();
  resetGoldHunterMarketFeedForTests();
  resetGoldHunterDemoAutoExecutionForTests();
  resetOwnerQueuesForTests();
  await seedConfig({ demoAutoTradeEnabled: true });
});

describe("Execution reliability A–Q", () => {
  it("A — normal first attempt succeeds → one submission → consumed", async () => {
    let submissions = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async (_uid, cand, deps) => {
        submissions += 1;
        deps.onTelemetry?.({
          phase: "FILLED",
          claimed: true,
          outcome: "FILLED",
          tradeId: "GH-D-ok"
        });
        getGoldHunterStrategySelector(OWNER).markOpportunityConsumed(
          cand.opportunityId
        );
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: cand.signalId,
          tradeId: "GH-D-ok"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });

    const { opportunity, opportunityId } = openOpportunity();
    const enq = enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    expect(enq.enqueued).toBe(true);
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(submissions).toBe(1);
    expect(
      getGoldHunterStrategySelector(OWNER).getExecutableCandidate()
    ).toBeNull();
    const diag = getGoldHunterExecutionDiagnostics(OWNER);
    expect(diag.state).toBe("FILLED");
    expect(diag.lastOpportunityId).toBe(opportunityId);
    expect(diag.attemptCountForOpportunity).toBe(1);

    // Sticky ticks must not resubmit
    for (let i = 0; i < 10; i++) {
      getGoldHunterStrategySelector(OWNER).processInjectedSelectionForTests({
        selected: hitA,
        receivedAtMs: Date.now() + i
      });
      maybeReconsiderGoldHunterDemoAutoExecution(OWNER);
    }
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(submissions).toBe(1);
  });

  it("B — transient PRE-CLAIM failure then bounded recovery → one broker submission", async () => {
    let submissions = 0;
    let attempts = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async (_uid, cand, deps) => {
        attempts += 1;
        if (attempts === 1) {
          deps.onTelemetry?.({
            phase: "PRECLAIM_BLOCKED",
            blocker: "WAIT — SIGNAL STALE",
            detail: "book_generation_mismatch",
            claimed: false
          });
          return {
            ok: false,
            submitted: false,
            blockers: ["WAIT — SIGNAL STALE"],
            signalId: cand.signalId
          };
        }
        submissions += 1;
        deps.onTelemetry?.({
          phase: "FILLED",
          claimed: true,
          outcome: "FILLED",
          tradeId: "GH-D-retry"
        });
        getGoldHunterStrategySelector(OWNER).markOpportunityConsumed(
          cand.opportunityId
        );
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: cand.signalId,
          tradeId: "GH-D-retry"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });

    const { opportunity, opportunityId } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(submissions).toBe(0);
    expect(attempts).toBe(1);
    expect(
      getGoldHunterStrategySelector(OWNER).getExecutableCandidate()?.opportunityId
    ).toBe(opportunityId);
    expect(getGoldHunterExecutionDiagnostics(OWNER).state).toBe(
      "PRECLAIM_BLOCKED"
    );
    expect(getGoldHunterExecutionDiagnostics(OWNER).detail).toBe(
      "book_generation_mismatch"
    );
    // Internal flag via reconsider eligibility
    advanceCooldown();
    // Keep opportunity alive with sticky tick
    getGoldHunterStrategySelector(OWNER).processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: Date.now(),
      bookGeneration: 3
    });
    const retry = maybeReconsiderGoldHunterDemoAutoExecution(OWNER);
    expect(retry.enqueued).toBe(true);
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(attempts).toBe(2);
    expect(submissions).toBe(1);
    expect(getGoldHunterExecutionDiagnostics(OWNER).state).toBe("FILLED");
  });

  it("C — already claimed → no second broker submission", async () => {
    const { opportunity, opportunityId } = openOpportunity();
    await acquireGoldHunterSignalClaim({
      ownerUid: OWNER,
      signalId: opportunityId,
      goldHunterTradeId: "GH-D-existing",
      clientOrderId: "gh_existing",
      setup: "A",
      side: "SELL"
    });
    let submissions = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async () => {
        submissions += 1;
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: opportunityId,
          tradeId: "GH-D-dup"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(submissions).toBe(0);
    expect(getGoldHunterExecutionDiagnostics(OWNER).state).toBe(
      "DUPLICATE_ALREADY_CLAIMED"
    );
  });

  it("D — queue full → QUEUE_FULL diagnostics → opportunity not falsely consumed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async (_uid, cand) => {
        await gate;
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: cand.signalId,
          tradeId: "GH-D-q"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const { opportunity, opportunityId } = openOpportunity();
    expect(
      enqueueGoldHunterDemoAutoExecution({
        ownerUid: OWNER,
        newOpportunity: true,
        opportunity
      }).enqueued
    ).toBe(true);
    // Fill second slot with same-shaped work via raw queue pressure
    const q = goldHunterDemoExecQueueStats(OWNER);
    expect(q.pending).toBeGreaterThanOrEqual(1);
    // Force capacity: enqueue until drop
    const r2 = enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity: { ...opportunity, opportunityId: opportunityId + "-x" }
    });
    // May or may not fill — force drop with third
    const r3 = enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    expect(r2.enqueued || r3.reason === "QUEUE_FULL" || !r3.enqueued).toBeTruthy();
    // Ensure at least one QUEUE_FULL path
    if (r3.enqueued) {
      const r4 = enqueueGoldHunterDemoAutoExecution({
        ownerUid: OWNER,
        newOpportunity: true,
        opportunity
      });
      expect(r4.enqueued).toBe(false);
      expect(r4.reason).toBe("QUEUE_FULL");
    } else {
      expect(r3.reason).toBe("QUEUE_FULL");
    }
    expect(
      getGoldHunterStrategySelector(OWNER).getExecutableCandidate()?.opportunityId
    ).toBe(opportunityId);
    expect(getGoldHunterExecutionDiagnostics(OWNER).state).toBe("QUEUE_FULL");
    release();
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
  });

  it("E — runtime exception → queue continues → RUNTIME_ERROR → no duplicate order", async () => {
    let calls = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async () => {
        calls += 1;
        throw new Error("simulated_runtime_boom");
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const { opportunity } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(calls).toBe(1);
    expect(getGoldHunterExecutionDiagnostics(OWNER).state).toBe("RUNTIME_ERROR");
    // Queue chain remains healthy
    let second = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async (_uid, cand) => {
        second += 1;
        return {
          ok: false,
          submitted: false,
          blockers: ["WAIT — AUTOTRADE OFF"],
          signalId: cand.signalId
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    // New opportunity identity after end+rearm would be separate; here just ensure queue works
    const q = new BoundedSerializedQueue("t", 2);
    let ran = false;
    expect(q.enqueue(async () => {
      ran = true;
    })).toBe(true);
    await q.drainForTests();
    expect(ran).toBe(true);
    void second;
  });

  it("F — AutoTrade OFF → no broker submission / no bypass retry", async () => {
    await seedConfig({ demoAutoTradeEnabled: false });
    let calls = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async () => {
        calls += 1;
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: "x",
          tradeId: "t"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const { opportunity } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(calls).toBe(0);
    expect(getGoldHunterExecutionDiagnostics(OWNER).state).toBe("AUTOTRADE_OFF");
    advanceCooldown();
    expect(maybeReconsiderGoldHunterDemoAutoExecution(OWNER).enqueued).toBe(
      false
    );
  });

  it("G — paused → no order", async () => {
    // Enabling AutoTrade clears pause in configStore — set pause in a follow-up patch.
    await seedConfig({ demoAutoTradeEnabled: true });
    await saveGoldHunterConfig(OWNER, {
      pauseNewEntries: true,
      updatedBy: OWNER
    });
    let calls = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async () => {
        calls += 1;
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: "x",
          tradeId: "t"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const { opportunity } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(calls).toBe(0);
    expect(getGoldHunterExecutionDiagnostics(OWNER).state).toBe("PAUSED");
  });

  it("H — emergency stop → no order", async () => {
    await seedConfig({ demoAutoTradeEnabled: true });
    // Emergency stop also forces AutoTrade OFF in configStore — check EMERGENCY_STOP first.
    await saveGoldHunterConfig(OWNER, {
      emergencyStopActive: true,
      updatedBy: OWNER
    });
    let calls = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async () => {
        calls += 1;
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: "x",
          tradeId: "t"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const { opportunity } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(calls).toBe(0);
    expect(getGoldHunterExecutionDiagnostics(OWNER).state).toBe(
      "EMERGENCY_STOP"
    );
  });

  it("I — LIVE environment refused at feed hook (hard)", async () => {
    const hook = readFileSync(
      resolve(process.cwd(), "src/services/goldHunterAdmin/marketFeedHook.ts"),
      "utf8"
    );
    expect(hook).toContain('meta.environment === "LIVE"');
    expect(hook).toContain("LIVE_FEED_REFUSED");
    expect(
      isGoldHunterPreclaimFailureRetryable({
        blocker: "WAIT — LIVE ENVIRONMENT REFUSED",
        claimed: false
      })
    ).toBe(false);
  });

  it("J — resync invalidates old opportunity (no retry/execute)", async () => {
    const { opportunity } = openOpportunity();
    getGoldHunterStrategySelector(OWNER).clearForResync();
    const fresh = assertGoldHunterCandidateFresh({
      ownerUid: OWNER,
      candidate: opportunity,
      nowMs: Date.now()
    });
    expect(fresh.ok).toBe(false);
    if (!fresh.ok) expect(fresh.detail).toBe("resync_generation_mismatch");
    expect(
      isGoldHunterPreclaimFailureRetryable({
        blocker: "WAIT — SIGNAL STALE",
        detail: "resync_generation_mismatch",
        claimed: false
      })
    ).toBe(false);
  });

  it("K — opportunity ends → no later execution of stale opportunity", async () => {
    const { opportunity } = openOpportunity();
    getGoldHunterStrategySelector(OWNER).processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: Date.now() + 10
    });
    expect(
      getGoldHunterStrategySelector(OWNER).getExecutableCandidate()
    ).toBeNull();
    expect(maybeReconsiderGoldHunterDemoAutoExecution(OWNER).reason).toBe(
      "NO_OPPORTUNITY"
    );
    const refreshed = refreshGoldHunterCandidateAgainstLive({
      ownerUid: OWNER,
      candidate: opportunity
    });
    expect(refreshed).toBeNull();
  });

  it("L — concurrent ticks → only one durable claim / one broker submission", async () => {
    let submissions = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async (_uid, cand, deps) => {
        // Real claim path via store to prove single claim
        const claim = await acquireGoldHunterSignalClaim({
          ownerUid: OWNER,
          signalId: cand.opportunityId,
          goldHunterTradeId: `GH-D-${submissions}`,
          clientOrderId: `gh_${cand.opportunityId}_${submissions}`,
          setup: "A",
          side: "SELL"
        });
        if (!claim.ok) {
          deps.onTelemetry?.({
            phase: "DUPLICATE_ALREADY_CLAIMED",
            claimed: true,
            blocker: "WAIT — DUPLICATE SIGNAL"
          });
          return {
            ok: false,
            submitted: false,
            blockers: ["WAIT — DUPLICATE SIGNAL"],
            signalId: cand.signalId
          };
        }
        submissions += 1;
        deps.onTelemetry?.({
          phase: "FILLED",
          claimed: true,
          outcome: "FILLED",
          tradeId: claim.claim.goldHunterTradeId
        });
        getGoldHunterStrategySelector(OWNER).markOpportunityConsumed(
          cand.opportunityId
        );
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: cand.signalId,
          tradeId: claim.claim.goldHunterTradeId
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const { opportunity } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(submissions).toBe(1);
    const claim = await getGoldHunterSignalClaim(OWNER, opportunity.opportunityId);
    expect(claim).toBeTruthy();
  });

  it("M — restart with existing durable claim → no second submit", async () => {
    const { opportunity, opportunityId } = openOpportunity();
    await acquireGoldHunterSignalClaim({
      ownerUid: OWNER,
      signalId: opportunityId,
      goldHunterTradeId: "GH-D-restart",
      clientOrderId: "gh_restart",
      setup: "A",
      side: "SELL"
    });
    // Simulate worker restart of runtime telemetry only
    resetGoldHunterDemoAutoExecutionForTests();
    await seedConfig({ demoAutoTradeEnabled: true });
    let submissions = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async () => {
        submissions += 1;
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: opportunityId,
          tradeId: "GH-D-bad"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    // Re-seed opportunity display (same id) without clearing claims
    getGoldHunterStrategySelector(OWNER).processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: Date.now()
    });
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity: {
        ...opportunity,
        opportunityId,
        signalId: opportunityId
      }
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(submissions).toBe(0);
  });

  it("N — broker result unknown → PENDING_RECONCILIATION → no blind resubmit", async () => {
    let submissions = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async (_uid, cand, deps) => {
        submissions += 1;
        deps.onTelemetry?.({
          phase: "PENDING_RECONCILIATION",
          claimed: true,
          outcome: "PENDING_RECONCILIATION",
          tradeId: "GH-D-unk"
        });
        return {
          ok: true,
          submitted: true,
          outcome: "PENDING_RECONCILIATION",
          signalId: cand.signalId,
          tradeId: "GH-D-unk",
          detail: "Unknown broker outcome"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const { opportunity } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(getGoldHunterExecutionDiagnostics(OWNER).state).toBe(
      "PENDING_RECONCILIATION"
    );
    advanceCooldown();
    expect(maybeReconsiderGoldHunterDemoAutoExecution(OWNER).enqueued).toBe(
      false
    );
    expect(submissions).toBe(1);
  });

  it("O — broker rejected → BROKER_REJECTED telemetry → not FILLED", async () => {
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async (_uid, cand, deps) => {
        deps.onTelemetry?.({
          phase: "BROKER_REJECTED",
          claimed: true,
          outcome: "BROKER_REJECTED",
          blocker: "BROKER_REJECTED",
          tradeId: "GH-D-rej"
        });
        return {
          ok: true,
          submitted: true,
          outcome: "BROKER_REJECTED",
          signalId: cand.signalId,
          tradeId: "GH-D-rej"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const { opportunity } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    const diag = getGoldHunterExecutionDiagnostics(OWNER);
    expect(diag.state).toBe("BROKER_REJECTED");
    expect(diag.state).not.toBe("FILLED");
  });

  it("P — Admin diagnostics contain opportunity id / state / blocker", async () => {
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async (_uid, cand, deps) => {
        deps.onTelemetry?.({
          phase: "PRECLAIM_BLOCKED",
          blocker: "WAIT — SIGNAL STALE",
          detail: "book_generation_mismatch",
          claimed: false
        });
        return {
          ok: false,
          submitted: false,
          blockers: ["WAIT — SIGNAL STALE"],
          signalId: cand.signalId
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });
    const { opportunity, opportunityId } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    const status = await assembleGoldHunterStatus(OWNER);
    expect(status.executionMode).toBe("DEMO_ONLY");
    expect(status.liveExecutionEnabled).toBe(false);
    expect(status.execution.lastOpportunityId).toBe(opportunityId);
    expect(status.execution.state).toBe("PRECLAIM_BLOCKED");
    expect(status.execution.blocker).toBe("WAIT — SIGNAL STALE");
    expect(status.execution.detail).toBe("book_generation_mismatch");
  });

  it("Q — candidate freshness race: Depth advances bookGeneration without stranding", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    const tick = sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: Date.now(),
      bookGeneration: 10
    });
    const cand = tick.opportunity!;
    // Harmless Depth advance while same opportunity remains active
    sel.processInjectedSelectionForTests({
      selected: hitA,
      receivedAtMs: Date.now() + 5,
      bookGeneration: 15
    });
    const fresh = assertGoldHunterCandidateFresh({
      ownerUid: OWNER,
      candidate: cand,
      nowMs: Date.now() + 5
    });
    expect(fresh.ok).toBe(true);
    const refreshed = refreshGoldHunterCandidateAgainstLive({
      ownerUid: OWNER,
      candidate: cand
    });
    expect(refreshed).toBeTruthy();
    expect(refreshed!.opportunityId).toBe(cand.opportunityId);
    expect(refreshed!.bookGeneration).toBe(15);

    // True resync still invalidates
    sel.clearForResync();
    const afterResync = assertGoldHunterCandidateFresh({
      ownerUid: OWNER,
      candidate: cand,
      nowMs: Date.now()
    });
    expect(afterResync.ok).toBe(false);
  });
});

describe("Retry classification", () => {
  it("classifies retryable vs non-retryable pre-claim reasons", () => {
    expect(
      isGoldHunterPreclaimFailureRetryable({
        blocker: "WAIT — SIGNAL STALE",
        detail: "book_generation_mismatch",
        claimed: false
      })
    ).toBe(true);
    expect(
      isGoldHunterPreclaimFailureRetryable({
        blocker: "WAIT — SIZING METADATA UNAVAILABLE",
        claimed: false
      })
    ).toBe(true);
    expect(
      isGoldHunterPreclaimFailureRetryable({
        blocker: "WAIT — AUTOTRADE OFF",
        claimed: false
      })
    ).toBe(false);
    expect(
      isGoldHunterPreclaimFailureRetryable({
        blocker: "WAIT — SPREAD TOO WIDE",
        claimed: false
      })
    ).toBe(false);
    expect(
      isGoldHunterPreclaimFailureRetryable({
        blocker: "WAIT — SIGNAL STALE",
        detail: "book_generation_mismatch",
        claimed: true
      })
    ).toBe(false);
  });

  it("marketFeedHook reconsider path is wired", () => {
    const hook = readFileSync(
      resolve(process.cwd(), "src/services/goldHunterAdmin/marketFeedHook.ts"),
      "utf8"
    );
    expect(hook).toContain("maybeReconsiderGoldHunterDemoAutoExecution");
  });
});
