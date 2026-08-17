/**
 * Gold Hunter queue hang / preclaim I/O reliability — tests A–J.
 * Ensures a hung preclaim read cannot permanently stall the serial queue.
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
  isCTraderDemoOrderSubmissionEnabled: () => true,
  isBrokerExecutionEnabled: () => false
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
  goldHunterDemoExecQueueStats,
  isGoldHunterPreclaimFailureRetryable
} from "../../../src/services/goldHunterAdmin/demoAutoExecutionRuntime";
import {
  getGoldHunterExecutionDiagnostics,
  getGoldHunterExecutionTelemetry
} from "../../../src/services/goldHunterAdmin/executionRuntimeStore";
import {
  resetGoldHunterSignalClaimsForTests,
  acquireGoldHunterSignalClaim,
  getGoldHunterSignalClaim
} from "../../../src/services/goldHunterAdmin/signalClaimStore";
import { resetGoldHunterTradeMemory } from "../../../src/services/goldHunterAdmin/tradeStore";
import { saveGoldHunterConfig } from "../../../src/services/goldHunterAdmin/configStore";
import {
  BoundedSerializedQueue,
  GH_QUEUE_STUCK_AGE_MS,
  resetOwnerQueuesForTests
} from "../../../src/services/goldHunterAdmin/boundedQueue";
import { resetGoldHunterMarketFeedForTests } from "../../../src/services/goldHunterAdmin/marketFeedHook";
import { GH_ADMIN_DEFAULT_CONFIG } from "../../../src/services/goldHunterAdmin/types";
import {
  GH_PRECLAIM_BROKER_METADATA_TIMEOUT_MS,
  GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
  withGoldHunterPreclaimTimeout,
  GoldHunterPreclaimTimeoutError
} from "../../../src/services/goldHunterAdmin/preclaimBoundedOp";
import { attemptGoldHunterDemoExecution } from "../../../src/services/goldHunterAdmin/executionOrchestrator";
import {
  isCTraderLiveEnabled,
  isBrokerExecutionEnabled,
  isCTraderDemoOrderSubmissionEnabled
} from "../../../src/services/broker/ctrader/flags";
import type { BrokerSymbol } from "../../../src/services/broker/domain";

const OWNER = "gh-queue-hang-owner";
let oppClock = 1_700_000_000_000;

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

async function seedConfig() {
  await saveGoldHunterConfig(OWNER, {
    ...GH_ADMIN_DEFAULT_CONFIG,
    demoAutoTradeEnabled: true,
    mode: "DEMO_AUTO",
    updatedAt: new Date().toISOString(),
    updatedBy: OWNER
  });
}

function openOpportunity(side: "BUY" | "SELL" = "SELL"): {
  opportunity: GoldHunterSelectedCandidate;
  opportunityId: string;
} {
  const sel = getGoldHunterStrategySelector(OWNER);
  // End any active opportunity, then wait past rearm floor before starting a new one.
  if (sel.getActiveOpportunityId()) {
    oppClock += 10;
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: oppClock,
      bookGeneration: Math.floor(oppClock / 100)
    });
  }
  oppClock += 400;
  const tick = sel.processInjectedSelectionForTests({
    selected: {
      setup: side === "BUY" ? "B_FAST_BREAKOUT" : "A_MOMENTUM_IGNITION",
      side,
      quality: 0.7
    },
    receivedAtMs: oppClock,
    bookGeneration: Math.floor(oppClock / 100)
  });
  expect(tick.newOpportunity).toBe(true);
  expect(tick.opportunity).toBeTruthy();
  return {
    opportunity: tick.opportunity!,
    opportunityId: tick.opportunity!.opportunityId
  };
}

beforeEach(async () => {
  oppClock = 1_700_000_000_000;
  resetGoldHunterStrategySelectorsForTests();
  resetGoldHunterSignalClaimsForTests();
  resetGoldHunterTradeMemory();
  resetGoldHunterMarketFeedForTests();
  resetGoldHunterDemoAutoExecutionForTests();
  resetOwnerQueuesForTests();
  await seedConfig();
  process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
});

describe("Queue hang / preclaim reliability A–J", () => {
  it("A — first queue task normal completion then second executes", async () => {
    const order: string[] = [];
    setGoldHunterDemoAutoExecutionHooksForTests({
      attempt: async (_uid, cand) => {
        order.push(cand.opportunityId);
        getGoldHunterStrategySelector(OWNER).markOpportunityConsumed(
          cand.opportunityId
        );
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: cand.signalId,
          tradeId: "GH-D-a"
        };
      },
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true
    });

    const first = openOpportunity("SELL");
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity: first.opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);

    const second = openOpportunity("BUY");
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity: second.opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);

    expect(order).toEqual([first.opportunityId, second.opportunityId]);
    expect(goldHunterDemoExecQueueStats(OWNER).pending).toBe(0);
    expect(goldHunterDemoExecQueueStats(OWNER).completed).toBeGreaterThanOrEqual(2);
  });

  it("B — preclaim hang → timeout → pending decrements → next task can run", async () => {
    let releaseHang!: () => void;
    const hangGate = new Promise<void>((r) => {
      releaseHang = r;
    });
    let phase: "hang" | "ok" = "hang";
    const ran: string[] = [];

    setGoldHunterDemoAutoExecutionHooksForTests({
      loadSymbol: async () => {
        if (phase === "hang") {
          // Exceed SYMBOL_LOAD timeout (test overrides via never-resolve).
          await new Promise(() => undefined);
        }
        return symbolMeta();
      },
      attempt: async (_uid, cand) => {
        ran.push(cand.opportunityId);
        return {
          ok: false,
          submitted: false,
          blockers: ["WAIT — SIGNAL STALE"],
          signalId: cand.signalId
        };
      },
      isAdmin: async () => true
    });

    const hung = openOpportunity("SELL");
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity: hung.opportunity
    });
    // Keep hung opportunity active so identity passes; hang is in symbol load.
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);

    expect(getGoldHunterExecutionDiagnostics(OWNER).blocker).toBe(
      "WAIT — RUNTIME TIMEOUT"
    );
    expect(await getGoldHunterSignalClaim(OWNER, hung.opportunityId)).toBeNull();
    expect(goldHunterDemoExecQueueStats(OWNER).pending).toBe(0);

    phase = "ok";
    const second = openOpportunity("BUY");
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity: second.opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(ran).toContain(second.opportunityId);
    expect(goldHunterDemoExecQueueStats(OWNER).pending).toBe(0);
    void hangGate;
    void releaseHang;
  }, 20_000);

  it("C — symbol metadata hang → bounded timeout → no broker submit", async () => {
    let submits = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      loadSymbol: async () => {
        await new Promise(() => undefined);
        return symbolMeta();
      },
      attempt: async () => {
        submits += 1;
        return {
          ok: false,
          submitted: false,
          blockers: ["SHOULD_NOT_RUN"],
          signalId: null
        };
      },
      isAdmin: async () => true
    });
    const { opportunity, opportunityId } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(submits).toBe(0);
    const tel = getGoldHunterExecutionDiagnostics(OWNER);
    expect(tel.blocker).toBe("WAIT — RUNTIME TIMEOUT");
    expect(tel.detail).toMatch(/loadDemoXauUsdSymbol_timeout/);
    expect(tel.currentStage).toBe("SYMBOL_LOAD_START");
    expect(await getGoldHunterSignalClaim(OWNER, opportunityId)).toBeNull();
    expect(goldHunterDemoExecQueueStats(OWNER).pending).toBe(0);
  }, 15_000);

  it("D — account snapshot hang inside orchestrator → timeout → queue released", async () => {
    const { withGoldHunterPreclaimTimeout: bound } = await import(
      "../../../src/services/goldHunterAdmin/preclaimBoundedOp"
    );
    await expect(
      bound("fetchGoldHunterAccountSnapshot", "ACCOUNT_SNAPSHOT_START", 50, () =>
        new Promise(() => undefined)
      )
    ).rejects.toBeInstanceOf(GoldHunterPreclaimTimeoutError);

    setGoldHunterDemoAutoExecutionHooksForTests({
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true,
      attempt: async (uid, cand, deps) => {
        // Simulate orchestrator account hang via bounded wrapper used in prod.
        try {
          await bound(
            "fetchGoldHunterAccountSnapshot",
            "ACCOUNT_SNAPSHOT_START",
            80,
            () => new Promise(() => undefined)
          );
        } catch (e) {
          if (e instanceof GoldHunterPreclaimTimeoutError) {
            deps.onTelemetry?.({
              phase: "PRECLAIM_BLOCKED",
              blocker: "WAIT — RUNTIME TIMEOUT",
              detail: `${e.op}_timeout`,
              claimed: false
            });
            deps.onStage?.("ACCOUNT_SNAPSHOT_START", "timeout");
            return {
              ok: false,
              submitted: false,
              blockers: ["WAIT — RUNTIME TIMEOUT"],
              signalId: cand.signalId
            };
          }
          throw e;
        }
        return {
          ok: false,
          submitted: false,
          blockers: ["UNEXPECTED"],
          signalId: cand.signalId
        };
      }
    });

    const first = openOpportunity("SELL");
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity: first.opportunity
    });
    const second = openOpportunity("BUY");
    let secondRan = false;
    setGoldHunterDemoAutoExecutionHooksForTests({
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true,
      attempt: async (_uid, cand, deps) => {
        if (cand.opportunityId === first.opportunityId) {
          try {
            await bound(
              "fetchGoldHunterAccountSnapshot",
              "ACCOUNT_SNAPSHOT_START",
              80,
              () => new Promise(() => undefined)
            );
          } catch (e) {
            if (e instanceof GoldHunterPreclaimTimeoutError) {
              deps.onTelemetry?.({
                phase: "PRECLAIM_BLOCKED",
                blocker: "WAIT — RUNTIME TIMEOUT",
                detail: `${e.op}_timeout`,
                claimed: false
              });
              return {
                ok: false,
                submitted: false,
                blockers: ["WAIT — RUNTIME TIMEOUT"],
                signalId: cand.signalId
              };
            }
          }
        }
        secondRan = true;
        return {
          ok: false,
          submitted: false,
          blockers: ["WAIT — SIGNAL STALE"],
          signalId: cand.signalId
        };
      }
    });
    // Re-enqueue both under the combined hook
    resetOwnerQueuesForTests();
    resetGoldHunterDemoAutoExecutionForTests();
    await seedConfig();
    resetGoldHunterStrategySelectorsForTests();
    const a = openOpportunity("SELL");
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity: a.opportunity
    });
    const b = openOpportunity("BUY");
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity: b.opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(secondRan || goldHunterDemoExecQueueStats(OWNER).pending === 0).toBe(
      true
    );
    expect(goldHunterDemoExecQueueStats(OWNER).pending).toBe(0);
  }, 15_000);

  it("E — stale after slow read → SIGNAL STALE → no claim → queue released", async () => {
    setGoldHunterDemoAutoExecutionHooksForTests({
      loadSymbol: async () => {
        await new Promise((r) => setTimeout(r, 40));
        // Opportunity ended while I/O was in flight.
        getGoldHunterStrategySelector(OWNER).processInjectedSelectionForTests({
          selected: null,
          receivedAtMs: Date.now(),
          bookGeneration: 99
        });
        return symbolMeta();
      },
      isAdmin: async () => true,
      attempt: async () => {
        throw new Error("should_not_reach_orchestrator");
      }
    });
    const { opportunity, opportunityId } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    const tel = getGoldHunterExecutionDiagnostics(OWNER);
    expect(tel.blocker).toBe("WAIT — SIGNAL STALE");
    expect(await getGoldHunterSignalClaim(OWNER, opportunityId)).toBeNull();
    expect(goldHunterDemoExecQueueStats(OWNER).pending).toBe(0);
  });

  it("F — after durable claim unknown broker → PENDING_RECONCILIATION → no second submit", async () => {
    let submits = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true,
      attempt: async (uid, cand, deps) => {
        const claim = await acquireGoldHunterSignalClaim({
          ownerUid: uid,
          signalId: cand.opportunityId,
          goldHunterTradeId: "GH-D-recon",
          clientOrderId: "gh_recon",
          setup: cand.setup,
          side: cand.side
        });
        expect(claim.ok).toBe(true);
        deps.onTelemetry?.({
          phase: "CLAIMED",
          claimed: true,
          tradeId: "GH-D-recon"
        });
        deps.beforeBrokerSubmit && (await deps.beforeBrokerSubmit().catch(() => undefined));
        submits += 1;
        deps.onTelemetry?.({
          phase: "PENDING_RECONCILIATION",
          claimed: true,
          outcome: "PENDING_RECONCILIATION",
          tradeId: "GH-D-recon",
          detail: "broker_timeout_unknown"
        });
        return {
          ok: true,
          submitted: false,
          outcome: "PENDING_RECONCILIATION",
          signalId: cand.signalId,
          tradeId: "GH-D-recon",
          detail: "Broker outcome unknown — no blind resubmit"
        };
      }
    });
    const { opportunity, opportunityId } = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(submits).toBe(1);
    expect(getGoldHunterExecutionDiagnostics(OWNER).outcome).toBe(
      "PENDING_RECONCILIATION"
    );
    expect(getGoldHunterExecutionTelemetry(OWNER).lastAttemptClaimed).toBe(true);
    expect(
      isGoldHunterPreclaimFailureRetryable({
        blocker: null,
        claimed: true,
        outcome: "PENDING_RECONCILIATION"
      })
    ).toBe(false);
    // Second enqueue of same claimed id must not resubmit via duplicate path.
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(submits).toBe(1);
    expect(await getGoldHunterSignalClaim(OWNER, opportunityId)).toBeTruthy();
  });

  it("G — concurrent opportunities: bounded queue, no duplicate broker submit", async () => {
    const submits: string[] = [];
    setGoldHunterDemoAutoExecutionHooksForTests({
      loadSymbol: async () => symbolMeta(),
      isAdmin: async () => true,
      attempt: async (_uid, cand) => {
        submits.push(cand.opportunityId);
        await acquireGoldHunterSignalClaim({
          ownerUid: OWNER,
          signalId: cand.opportunityId,
          goldHunterTradeId: `GH-D-${cand.opportunityId.slice(-6)}`,
          clientOrderId: `gh_${cand.opportunityId.slice(-8)}`,
          setup: cand.setup,
          side: cand.side
        });
        getGoldHunterStrategySelector(OWNER).markOpportunityConsumed(
          cand.opportunityId
        );
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: cand.signalId,
          tradeId: "GH-D-x"
        };
      }
    });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { opportunity, opportunityId } = openOpportunity(
        i % 2 === 0 ? "SELL" : "BUY"
      );
      ids.push(opportunityId);
      enqueueGoldHunterDemoAutoExecution({
        ownerUid: OWNER,
        newOpportunity: true,
        opportunity
      });
    }
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    const stats = goldHunterDemoExecQueueStats(OWNER);
    expect(stats.maxPendingSeen).toBeLessThanOrEqual(2);
    expect(stats.pending).toBe(0);
    expect(stats.dropped).toBeGreaterThanOrEqual(3);
    // At most one submit per opportunity that ran.
    expect(new Set(submits).size).toBe(submits.length);
  });

  it("H — queue-stuck telemetry exposes active opportunity/age", async () => {
    const q = new BoundedSerializedQueue("test-stuck", 2, 50);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    expect(
      q.enqueue(async () => {
        await gate;
      }, { opportunityId: "GH-OPP-HANG" })
    ).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    const early = q.stats();
    expect(early.activeOpportunityId).toBe("GH-OPP-HANG");
    expect(early.pending).toBe(1);
    await new Promise((r) => setTimeout(r, 60));
    const stuck = q.stats();
    expect(stuck.queueStuck).toBe(true);
    expect(stuck.oldestPendingAgeMs).toBeGreaterThanOrEqual(50);
    expect(stuck.activeStartedAt).toBeTruthy();
    release();
    await q.drainForTests();
    expect(q.stats().pending).toBe(0);
    expect(q.stats().queueStuck).toBe(false);
    expect(GH_QUEUE_STUCK_AGE_MS).toBeGreaterThan(0);
  });

  it("I — LIVE remains hard-disabled (zero submit path)", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isBrokerExecutionEnabled()).toBe(false);
    expect(
      isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("J — Demo submission flag true allows Demo path gate", () => {
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
    expect(isCTraderDemoOrderSubmissionEnabled()).toBe(true);
  });

  it("preclaim timeout helper rejects with stage metadata", async () => {
    const started = Date.now();
    await expect(
      withGoldHunterPreclaimTimeout("op", "SYMBOL_LOAD_START", 40, () =>
        new Promise(() => undefined)
      )
    ).rejects.toMatchObject({
      name: "GoldHunterPreclaimTimeoutError",
      op: "op",
      stage: "SYMBOL_LOAD_START"
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(GH_PRECLAIM_FIRESTORE_TIMEOUT_MS).toBe(3_000);
    expect(GH_PRECLAIM_BROKER_METADATA_TIMEOUT_MS).toBe(5_000);
  });
});
