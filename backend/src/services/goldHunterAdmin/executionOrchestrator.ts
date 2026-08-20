/**
 * Gold Hunter Demo execution orchestrator.
 * Claim → size → protect → submit. Durable dedupe before broker.
 * Claim key = opportunity identity (candidate.signalId / opportunityId).
 */
import { randomBytes } from "crypto";
import type { DemoMarketOrderResult } from "../broker/ctrader/openApiClient";
import type { BrokerOpenPosition } from "../broker/ctrader/openApiClient";
import type { SubmitDemoMarketOrderArgs } from "../broker/ctrader/demoOrderExecution";
import { fetchGoldHunterAccountSnapshot } from "./accountSnapshot";
import { assertGoldHunterCandidateFresh } from "./candidateFreshness";
import { computeGoldHunterCommittedCapital } from "./committedCapital";
import { submitGoldHunterDemoOrder } from "./demoExecutionAdapter";
import { registerGoldHunterOpenPositionForOwner } from "./demoPositionManager";
import { recoverGoldHunterOpenEntryImmediate } from "./immediateOpenEntryRecovery";
import {
  evaluateGoldHunterFinalLossSafetyForCandidate
} from "./lossSafetyGate";
import { loadGoldHunterConfig } from "./configStore";
import {
  metadataFromBrokerSymbol,
  type GoldHunterInstrumentMetadata
} from "./instrumentMetadata";
import { deriveGoldHunterInitialProtection } from "./protectionGeometry";
import { sizeGoldHunterDemoLots } from "./riskSizing";
import {
  acquireGoldHunterSignalClaim,
  getGoldHunterSignalClaim,
  updateGoldHunterSignalClaim
} from "./signalClaimStore";
import {
  getGoldHunterStrategySelector,
  type GoldHunterSelectedCandidate
} from "./strategySelector";
import { listGoldHunterDemoTrades } from "./tradeStore";
import type { BrokerSymbol } from "../broker/domain";
import { GH_ADMIN_STRATEGY_ID } from "./types";
import { frozenGhFastSoakConfig } from "./abc";
import { evaluateGoldHunterPreClaimProjectedDailyRisk } from "./projectedDailyRisk";
import {
  releaseGoldHunterMaxOpenSlot,
  reserveGoldHunterMaxOpenSlot
} from "./maxOpenLease";
import { countsTowardGoldHunterMaxOpen } from "./tradeStore";
import { validateGoldHunterRiskConfig } from "./configValidation";
import { runGoldHunterReconcilePass } from "./reconciliationRuntime";

import type { GoldHunterExecutionStage } from "./executionStages";
import {
  GH_PRECLAIM_ACCOUNT_TIMEOUT_MS,
  GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
  isGoldHunterPreclaimTimeout,
  withGoldHunterPreclaimTimeout
} from "./preclaimBoundedOp";

export type OrchestratorTelemetryHook = (ev: {
  phase:
    | "PRECLAIM_CHECK"
    | "PRECLAIM_BLOCKED"
    | "CLAIMING"
    | "CLAIMED"
    | "SUBMITTING"
    | "FILLED"
    | "ACCEPTED_PENDING_FILL"
    | "BROKER_REJECTED"
    | "BROKER_SUBMIT_ERROR"
    | "PENDING_RECONCILIATION"
    | "DUPLICATE_ALREADY_CLAIMED"
    | "RUNTIME_ERROR";
  blocker?: string | null;
  detail?: string | null;
  claimed?: boolean;
  outcome?: string | null;
  tradeId?: string | null;
  brokerOrderId?: string | null;
  brokerPositionId?: string | null;
}) => void;

export type OrchestratorStageHook = (
  stage: GoldHunterExecutionStage,
  kind: "start" | "done" | "timeout"
) => void;

export type OrchestratorDeps = {
  isAdmin: boolean;
  marketOpen: boolean;
  feedFresh: boolean;
  /** Injected symbol catalogue row (required for sizing). */
  symbol: BrokerSymbol;
  placeOrder?: (args: SubmitDemoMarketOrderArgs) => Promise<DemoMarketOrderResult>;
  /** Test/prod hook for immediate OPEN entry recovery after PENDING. */
  listOpenPositions?: (ownerUid: string) => Promise<BrokerOpenPosition[]>;
  /** Simulate broker hang after claim (tests). */
  beforeBrokerSubmit?: () => Promise<void>;
  /** Override freshness gate (production uses assertGoldHunterCandidateFresh). */
  assertFresh?: typeof assertGoldHunterCandidateFresh;
  /** Optional execution telemetry (Gold Hunter Admin diagnostics). */
  onTelemetry?: OrchestratorTelemetryHook;
  /** Optional stage lifecycle hooks (hang diagnosis). */
  onStage?: OrchestratorStageHook;
};

export type OrchestratorResult =
  | {
      ok: true;
      submitted: boolean;
      outcome: string;
      signalId: string;
      tradeId: string | null;
      detail?: string;
    }
  | {
      ok: false;
      submitted: false;
      blockers: string[];
      signalId: string | null;
    };

/**
 * Attempt one Demo submission for an executable selected candidate.
 * Durable claim uses opportunity identity (signalId === opportunityId).
 */
export async function attemptGoldHunterDemoExecution(
  ownerUid: string,
  candidate: GoldHunterSelectedCandidate,
  deps: OrchestratorDeps
): Promise<OrchestratorResult> {
  const opportunityId = candidate.opportunityId || candidate.signalId;
  const tel = deps.onTelemetry;

  const block = (
    blocker: string,
    detail?: string
  ): OrchestratorResult => {
    tel?.({
      phase:
        blocker === "WAIT — DUPLICATE SIGNAL"
          ? "DUPLICATE_ALREADY_CLAIMED"
          : "PRECLAIM_BLOCKED",
      blocker,
      detail: detail ?? null,
      claimed: false
    });
    return {
      ok: false,
      submitted: false,
      blockers: [blocker],
      signalId: opportunityId
    };
  };

  if (!candidate.depthExecutable) {
    return block("WAIT — DEPTH INVALID", "candidate_depth_not_executable");
  }
  if (candidate.consumed) {
    return block("WAIT — DUPLICATE SIGNAL", "candidate_already_consumed");
  }

  tel?.({ phase: "PRECLAIM_CHECK" });

  const checkFresh = deps.assertFresh ?? assertGoldHunterCandidateFresh;
  const fresh = checkFresh({
    ownerUid,
    candidate: { ...candidate, signalId: opportunityId, opportunityId }
  });
  deps.onStage?.("FRESHNESS_CHECK_DONE", fresh.ok ? "done" : "done");
  if (!fresh.ok) {
    return block(fresh.blocker, fresh.detail);
  }

  deps.onStage?.("CONFIG_RELOAD_START", "start");
  let config;
  try {
    config = await withGoldHunterPreclaimTimeout(
      "loadGoldHunterConfig",
      "CONFIG_RELOAD_START",
      GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
      () => loadGoldHunterConfig(ownerUid)
    );
  } catch (e) {
    if (isGoldHunterPreclaimTimeout(e)) {
      deps.onStage?.("CONFIG_RELOAD_START", "timeout");
      return block("WAIT — RUNTIME TIMEOUT", `${e.op}_timeout`);
    }
    throw e;
  }
  deps.onStage?.("CONFIG_RELOAD_DONE", "done");

  const cfgOk = validateGoldHunterRiskConfig(config);
  if (!cfgOk.ok) {
    return block(
      "WAIT — CONFIG INVALID",
      cfgOk.detail ?? "risk_config_invalid"
    );
  }

  const meta: GoldHunterInstrumentMetadata = metadataFromBrokerSymbol(deps.symbol);
  if (!meta.complete) {
    return block("WAIT — SIZING METADATA UNAVAILABLE", "metadata_incomplete");
  }

  const protection = deriveGoldHunterInitialProtection({
    side: candidate.side,
    entryPrice: candidate.side === "BUY" ? candidate.ask : candidate.bid
  });
  if (!protection.ok) {
    return block(
      "WAIT — PROTECTION GEOMETRY NOT CONNECTED",
      "protection_derive_failed"
    );
  }

  deps.onStage?.("OPEN_TRADES_LOAD_START", "start");
  let openTrades;
  try {
    openTrades = await withGoldHunterPreclaimTimeout(
      "listGoldHunterDemoTrades",
      "OPEN_TRADES_LOAD_START",
      GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
      () =>
        listGoldHunterDemoTrades(ownerUid, {
          limit: 50,
          openOnly: true
        })
    );
  } catch (e) {
    if (isGoldHunterPreclaimTimeout(e)) {
      deps.onStage?.("OPEN_TRADES_LOAD_START", "timeout");
      return block("WAIT — RUNTIME TIMEOUT", `${e.op}_timeout`);
    }
    throw e;
  }
  deps.onStage?.("OPEN_TRADES_LOAD_DONE", "done");

  // Local occupancy can include stale CLOSE_REQUESTED ghosts. Repair from
  // authoritative broker state BEFORE a permanent local-only max-open deadlock.
  // Do not delete this gate — fail closed when broker open state is unknown.
  if (openTrades.length >= config.maxOpenTrades) {
    deps.onStage?.("PRE_MAXOPEN_RECONCILE_START", "start");
    let preMaxReconcile: Awaited<ReturnType<typeof runGoldHunterReconcilePass>>;
    try {
      preMaxReconcile = await withGoldHunterPreclaimTimeout(
        "runGoldHunterReconcilePass_preMaxOpen",
        "PRE_MAXOPEN_RECONCILE_START",
        GH_PRECLAIM_ACCOUNT_TIMEOUT_MS + GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
        () =>
          runGoldHunterReconcilePass({
            ownerUid,
            force: true
          })
      );
    } catch (e) {
      if (isGoldHunterPreclaimTimeout(e)) {
        deps.onStage?.("PRE_MAXOPEN_RECONCILE_START", "timeout");
        return block(
          "WAIT — MAX OPEN TRADES",
          "pre_maxopen_reconcile_timeout_fail_closed"
        );
      }
      throw e;
    }
    deps.onStage?.("PRE_MAXOPEN_RECONCILE_DONE", "done");

    if (!preMaxReconcile.positionsReadOk) {
      return block(
        "WAIT — MAX OPEN TRADES",
        "broker_positions_read_failed_fail_closed"
      );
    }

    try {
      openTrades = await withGoldHunterPreclaimTimeout(
        "listGoldHunterDemoTrades_after_pre_maxopen_reconcile",
        "OPEN_TRADES_LOAD_START",
        GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
        () =>
          listGoldHunterDemoTrades(ownerUid, {
            limit: 50,
            openOnly: true
          })
      );
    } catch (e) {
      if (isGoldHunterPreclaimTimeout(e)) {
        return block("WAIT — RUNTIME TIMEOUT", `${e.op}_timeout`);
      }
      throw e;
    }

    const localOpen = openTrades.filter(countsTowardGoldHunterMaxOpen).length;
    if (localOpen >= config.maxOpenTrades) {
      return block(
        "WAIT — MAX OPEN TRADES",
        `open_count_${localOpen}_max_${config.maxOpenTrades}_after_reconcile`
      );
    }
  }

  const committed = computeGoldHunterCommittedCapital({
    config,
    openTrades
  });
  if (!committed.known || committed.availableEur == null) {
    return block("WAIT — COMMITTED CAPITAL UNKNOWN", "committed_capital_unknown");
  }

  const sized = sizeGoldHunterDemoLots({
    config,
    entry: protection.entryPrice,
    stop: protection.stopPrice,
    valuePerPointPerLot: meta.valuePerPointPerLot,
    minLots: meta.minLots,
    maxLots: meta.maxLots,
    lotStep: meta.lotStep,
    availableAllocationEur: committed.availableEur
  });
  if (!sized.ok) {
    const blocker = sized.blocker.startsWith("WAIT")
      ? sized.blocker
      : `WAIT — ${sized.blocker}`;
    return block(blocker, "sizing_refused");
  }

  deps.onStage?.("PROJECTED_DAILY_RISK_START", "start");
  let projectedRisk;
  try {
    projectedRisk = await withGoldHunterPreclaimTimeout(
      "evaluateGoldHunterPreClaimProjectedDailyRisk",
      "PROJECTED_DAILY_RISK_START",
      GH_PRECLAIM_ACCOUNT_TIMEOUT_MS + GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
      () =>
        evaluateGoldHunterPreClaimProjectedDailyRisk({
          ownerUid,
          config,
          proposedTradeRiskEur: sized.riskBudgetEur
        })
    );
  } catch (e) {
    if (isGoldHunterPreclaimTimeout(e)) {
      deps.onStage?.("PROJECTED_DAILY_RISK_START", "timeout");
      return block("WAIT — DAILY RISK UNKNOWN", `${e.op}_timeout`);
    }
    throw e;
  }
  deps.onStage?.("PROJECTED_DAILY_RISK_DONE", "done");
  if (!projectedRisk.allowed || !projectedRisk.authoritative) {
    return block(
      projectedRisk.blocker ?? "WAIT — DAILY RISK UNKNOWN",
      projectedRisk.detail ??
        `projected_${projectedRisk.projectedWorstCaseLossEur}_budget_${projectedRisk.dailyLossBudgetEur}`
    );
  }

  // Re-read open occupancy after reconcile inside projected-risk eval.
  try {
    openTrades = await withGoldHunterPreclaimTimeout(
      "listGoldHunterDemoTrades_after_risk",
      "OPEN_TRADES_LOAD_START",
      GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
      () =>
        listGoldHunterDemoTrades(ownerUid, {
          limit: 50,
          openOnly: true
        })
    );
  } catch (e) {
    if (isGoldHunterPreclaimTimeout(e)) {
      return block("WAIT — RUNTIME TIMEOUT", `${e.op}_timeout`);
    }
    throw e;
  }
  const brokerOpen = projectedRisk.brokerOpenGoldHunterCount;
  const localOpen = openTrades.filter(countsTowardGoldHunterMaxOpen).length;
  const knownOccupancy = Math.max(localOpen, brokerOpen);
  if (knownOccupancy >= config.maxOpenTrades) {
    return block(
      "WAIT — MAX OPEN TRADES",
      `open_count_${knownOccupancy}_max_${config.maxOpenTrades}_broker_${brokerOpen}_local_${localOpen}`
    );
  }

  deps.onStage?.("ACCOUNT_SNAPSHOT_START", "start");
  let account;
  try {
    account = await withGoldHunterPreclaimTimeout(
      "fetchGoldHunterAccountSnapshot",
      "ACCOUNT_SNAPSHOT_START",
      GH_PRECLAIM_ACCOUNT_TIMEOUT_MS,
      () => fetchGoldHunterAccountSnapshot({ ownerUid })
    );
  } catch (e) {
    if (isGoldHunterPreclaimTimeout(e)) {
      deps.onStage?.("ACCOUNT_SNAPSHOT_START", "timeout");
      return block("WAIT — RUNTIME TIMEOUT", `${e.op}_timeout`);
    }
    throw e;
  }
  deps.onStage?.("ACCOUNT_SNAPSHOT_DONE", "done");

  if (
    account.freeMargin != null &&
    Number.isFinite(account.freeMargin) &&
    account.freeMargin <= 0
  ) {
    return block("WAIT — CAPITAL LIMIT", "free_margin_non_positive");
  }

  const cfg = frozenGhFastSoakConfig();
  const spreadOk = candidate.spread <= cfg.maxSpread;

  const goldHunterTradeId = `GH-D-${randomBytes(4).toString("hex")}`;
  const clientOrderId = `gh_${opportunityId}`
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 50);

  const lease = await reserveGoldHunterMaxOpenSlot({
    ownerUid,
    maxOpenTrades: config.maxOpenTrades,
    reservationId: goldHunterTradeId,
    signalId: opportunityId,
    clientOrderId,
    knownOccupancy
  });
  if (!lease.ok) {
    return block("WAIT — MAX OPEN TRADES", lease.reason);
  }

  tel?.({ phase: "CLAIMING", tradeId: goldHunterTradeId });
  deps.onStage?.("CLAIM_CREATE_START", "start");

  let claim;
  try {
    claim = await withGoldHunterPreclaimTimeout(
      "acquireGoldHunterSignalClaim",
      "CLAIM_CREATE_START",
      GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
      () =>
        acquireGoldHunterSignalClaim({
          ownerUid,
          signalId: opportunityId,
          goldHunterTradeId,
          clientOrderId,
          setup: candidate.setup,
          side: candidate.side
        })
    );
  } catch (e) {
    await releaseGoldHunterMaxOpenSlot({
      ownerUid,
      reservationId: goldHunterTradeId
    }).catch(() => undefined);
    if (isGoldHunterPreclaimTimeout(e)) {
      deps.onStage?.("CLAIM_CREATE_START", "timeout");
      // Underlying write may still complete — inspect claim before failing closed.
      let existing = null;
      try {
        existing = await withGoldHunterPreclaimTimeout(
          "getGoldHunterSignalClaim_after_timeout",
          "CLAIM_CREATE_START",
          GH_PRECLAIM_FIRESTORE_TIMEOUT_MS,
          () => getGoldHunterSignalClaim(ownerUid, opportunityId)
        );
      } catch {
        existing = null;
      }
      if (existing) {
        getGoldHunterStrategySelector(ownerUid).markOpportunityConsumed(
          opportunityId
        );
        tel?.({
          phase: "PENDING_RECONCILIATION",
          claimed: true,
          outcome: "PENDING_RECONCILIATION",
          tradeId: existing.goldHunterTradeId,
          detail: "claim_create_timeout_claim_present"
        });
        return {
          ok: true,
          submitted: false,
          outcome: "PENDING_RECONCILIATION",
          signalId: opportunityId,
          tradeId: existing.goldHunterTradeId,
          detail: "Claim create timed out with claim present — no blind resubmit"
        };
      }
      return block("WAIT — RUNTIME TIMEOUT", `${e.op}_timeout`);
    }
    throw e;
  }
  deps.onStage?.("CLAIM_CREATE_DONE", "done");

  if (!claim.ok) {
    await releaseGoldHunterMaxOpenSlot({
      ownerUid,
      reservationId: goldHunterTradeId
    }).catch(() => undefined);
    getGoldHunterStrategySelector(ownerUid).markOpportunityConsumed(opportunityId);
    tel?.({
      phase: "DUPLICATE_ALREADY_CLAIMED",
      blocker: "WAIT — DUPLICATE SIGNAL",
      detail: claim.reason,
      claimed: true,
      tradeId: claim.claim.goldHunterTradeId
    });
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — DUPLICATE SIGNAL"],
      signalId: opportunityId
    };
  }

  // Mark opportunity consumed immediately after durable claim (before broker).
  getGoldHunterStrategySelector(ownerUid).markOpportunityConsumed(opportunityId);
  tel?.({ phase: "CLAIMED", claimed: true, tradeId: goldHunterTradeId });

  // Post-claim PnL / local gates run BEFORE claim state=SUBMITTING so
  // gold_hunter_broker_submit_started means transport is about to start.
  if (deps.beforeBrokerSubmit) {
    try {
      await deps.beforeBrokerSubmit();
    } catch {
      await releaseGoldHunterMaxOpenSlot({
        ownerUid,
        reservationId: goldHunterTradeId
      }).catch(() => undefined);
      await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
        state: "PENDING_RECONCILIATION",
        errorCode: "BROKER_TIMEOUT_UNKNOWN"
      });
      tel?.({
        phase: "PENDING_RECONCILIATION",
        claimed: true,
        outcome: "PENDING_RECONCILIATION",
        tradeId: goldHunterTradeId,
        detail: "broker_timeout_unknown"
      });
      return {
        ok: true,
        submitted: false,
        outcome: "PENDING_RECONCILIATION",
        signalId: opportunityId,
        tradeId: goldHunterTradeId,
        detail: "Broker outcome unknown — no blind resubmit"
      };
    }
  }

  deps.onStage?.("POST_CLAIM_PNL_START", "start");
  const dailyLossOk = projectedRisk.allowed && projectedRisk.authoritative;
  deps.onStage?.("POST_CLAIM_PNL_DONE", "done");
  if (!dailyLossOk) {
    await releaseGoldHunterMaxOpenSlot({
      ownerUid,
      reservationId: goldHunterTradeId
    }).catch(() => undefined);
    await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
      state: "BROKER_SUBMIT_ERROR",
      errorCode:
        projectedRisk.blocker ?? "WAIT — PROJECTED DAILY LOSS LIMIT"
    });
    tel?.({
      phase: "BROKER_SUBMIT_ERROR",
      claimed: true,
      outcome: "BROKER_SUBMIT_ERROR",
      blocker: projectedRisk.blocker ?? "WAIT — PROJECTED DAILY LOSS LIMIT",
      detail: "post_claim_projected_risk_recheck_failed",
      tradeId: goldHunterTradeId
    });
    return {
      ok: false,
      submitted: false,
      blockers: [
        projectedRisk.blocker ?? "WAIT — PROJECTED DAILY LOSS LIMIT"
      ],
      signalId: opportunityId
    };
  }

  try {
    // FINAL CURRENT loss-safety after all preclaim I/O, before transport.
    const lossGate = evaluateGoldHunterFinalLossSafetyForCandidate({
      ownerUid,
      candidate
    });
    if (!lossGate.ok) {
      await releaseGoldHunterMaxOpenSlot({
        ownerUid,
        reservationId: goldHunterTradeId
      }).catch(() => undefined);
      getGoldHunterStrategySelector(ownerUid).markOpportunityConsumed(
        opportunityId
      );
      await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
        state: "BROKER_SUBMIT_ERROR",
        errorCode: lossGate.rejectionReason ?? "WAIT — LOSS ANTI-CHURN"
      });
      tel?.({
        phase: "PRECLAIM_BLOCKED",
        claimed: true,
        outcome: "PRECLAIM_BLOCKED",
        blocker: lossGate.rejectionReason ?? "WAIT — LOSS ANTI-CHURN",
        detail: lossGate.detail ?? "final_pretransport_loss_safety",
        tradeId: goldHunterTradeId
      });
      return {
        ok: false,
        submitted: false,
        blockers: [
          lossGate.rejectionReason ?? "WAIT — LOSS ANTI-CHURN"
        ],
        signalId: opportunityId
      };
    }

    const result = await submitGoldHunterDemoOrder({
      ownerUid,
      isAdmin: deps.isAdmin,
      side: candidate.side,
      lots: sized.lots,
      stopLoss: protection.stopPrice,
      takeProfit: null,
      entryHint: protection.entryPrice,
      lossSafetyMid: (candidate.bid + candidate.ask) / 2,
      signedImbalance1s:
        (candidate as { signedImbalance1s?: number | null }).signedImbalance1s ??
        null,
      midVel250:
        (candidate as { midVel250?: number | null }).midVel250 ?? null,
      setup: candidate.setup,
      signalId: opportunityId,
      goldHunterTradeId,
      clientOrderId,
      symbolId: meta.symbolId,
      marketOpen: deps.marketOpen,
      feedFresh: deps.feedFresh,
      depthValid: true,
      spreadOk,
      capitalOk: committed.availableEur > 0,
      dailyLossOk,
      openTradeCount: openTrades.length,
      signalPresent: true,
      signalConsumed: false,
      accountSnapshotValid: account.validForRisk,
      placeOrder: deps.placeOrder,
      onEnterBrokerTransport: async () => {
        await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
          state: "SUBMITTING"
        });
        deps.onStage?.("SUBMITTING", "start");
        tel?.({
          phase: "SUBMITTING",
          claimed: true,
          tradeId: goldHunterTradeId
        });
      }
    });

    if (!result.ok) {
      // Local gate failure after claim — no ProtoOANewOrderReq was sent.
      await releaseGoldHunterMaxOpenSlot({
        ownerUid,
        reservationId: goldHunterTradeId
      }).catch(() => undefined);
      await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
        state: "BROKER_SUBMIT_ERROR",
        errorCode: result.blockers[0] ?? "GATES_BLOCKED"
      });
      tel?.({
        phase: "BROKER_SUBMIT_ERROR",
        claimed: true,
        outcome: "BROKER_SUBMIT_ERROR",
        blocker: result.blockers[0] ?? "GATES_BLOCKED",
        detail: "local_gate_before_transport",
        tradeId: goldHunterTradeId
      });
      return {
        ok: false,
        submitted: false,
        blockers: result.blockers,
        signalId: opportunityId
      };
    }

    if (result.outcome === "FILLED") {
      await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
        state: "OPEN",
        brokerOrderId: result.trade?.brokerOrderId ?? null,
        brokerPositionId: result.trade?.brokerPositionId ?? null,
        goldHunterTradeId
      });
      if (result.trade) {
        registerGoldHunterOpenPositionForOwner({
          ownerUid,
          trade: result.trade,
          bid: candidate.bid,
          ask: candidate.ask
        });
      }
      tel?.({
        phase: "FILLED",
        claimed: true,
        outcome: "FILLED",
        tradeId: result.trade?.goldHunterTradeId ?? goldHunterTradeId,
        brokerOrderId: result.trade?.brokerOrderId ?? null,
        brokerPositionId: result.trade?.brokerPositionId ?? null
      });
    } else if (result.outcome === "BROKER_REJECTED") {
      await releaseGoldHunterMaxOpenSlot({
        ownerUid,
        reservationId: goldHunterTradeId
      }).catch(() => undefined);
      await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
        state: "BROKER_REJECTED",
        errorCode: result.errorCode,
        brokerOrderId: result.trade?.brokerOrderId ?? null
      });
      tel?.({
        phase: "BROKER_REJECTED",
        claimed: true,
        outcome: "BROKER_REJECTED",
        blocker: result.errorCode,
        tradeId: goldHunterTradeId,
        brokerOrderId: result.trade?.brokerOrderId ?? null
      });
    } else if (result.outcome === "BROKER_SUBMIT_ERROR") {
      // Uncertain transport — keep max-open lease until reconcile clears it.
      await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
        state: "BROKER_SUBMIT_ERROR",
        errorCode: result.errorCode
      });
      tel?.({
        phase: "BROKER_SUBMIT_ERROR",
        claimed: true,
        outcome: "BROKER_SUBMIT_ERROR",
        blocker: result.errorCode,
        tradeId: goldHunterTradeId
      });
    } else if (result.outcome === "ACCEPTED_PENDING_FILL") {
      await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
        state: "ACCEPTED",
        brokerOrderId: result.trade?.brokerOrderId ?? null,
        brokerPositionId: result.trade?.brokerPositionId ?? null,
        goldHunterTradeId
      });
      if (result.trade?.brokerPositionId) {
        const recovery = await recoverGoldHunterOpenEntryImmediate({
          ownerUid,
          trade: result.trade,
          bid: candidate.bid,
          ask: candidate.ask,
          listPositions: deps.listOpenPositions
        });
        if (recovery.recovered) {
          await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
            state: "OPEN",
            brokerOrderId: recovery.trade.brokerOrderId ?? null,
            brokerPositionId: recovery.trade.brokerPositionId ?? null,
            goldHunterTradeId
          });
          tel?.({
            phase: "FILLED",
            claimed: true,
            outcome: "FILLED",
            detail: "immediate_open_entry_recovery",
            tradeId: recovery.trade.goldHunterTradeId,
            brokerOrderId: recovery.trade.brokerOrderId ?? null,
            brokerPositionId: recovery.trade.brokerPositionId ?? null
          });
        } else {
          tel?.({
            phase: "ACCEPTED_PENDING_FILL",
            claimed: true,
            outcome: "ACCEPTED_PENDING_FILL",
            tradeId: goldHunterTradeId,
            brokerOrderId: result.trade?.brokerOrderId ?? null,
            brokerPositionId: result.trade?.brokerPositionId ?? null
          });
        }
      } else {
        tel?.({
          phase: "ACCEPTED_PENDING_FILL",
          claimed: true,
          outcome: "ACCEPTED_PENDING_FILL",
          tradeId: goldHunterTradeId,
          brokerOrderId: result.trade?.brokerOrderId ?? null,
          brokerPositionId: result.trade?.brokerPositionId ?? null
        });
      }
    } else if (result.outcome === "PENDING_RECONCILIATION") {
      await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
        state: "PENDING_RECONCILIATION",
        errorCode: result.errorCode,
        brokerOrderId: result.trade?.brokerOrderId ?? null,
        brokerPositionId: result.trade?.brokerPositionId ?? null
      });
      // Immediate bounded open-position entry recovery while still OPEN.
      // Settlement BROKER_DEAL_SETTLEMENT remains fallback if this fails.
      let recoveredTrade = result.trade ?? null;
      if (result.trade?.brokerPositionId) {
        const recovery = await recoverGoldHunterOpenEntryImmediate({
          ownerUid,
          trade: result.trade,
          bid: candidate.bid,
          ask: candidate.ask,
          listPositions: deps.listOpenPositions
        });
        if (recovery.recovered) {
          recoveredTrade = recovery.trade;
          await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
            state: "OPEN",
            brokerOrderId: recovery.trade.brokerOrderId ?? null,
            brokerPositionId: recovery.trade.brokerPositionId ?? null,
            goldHunterTradeId
          });
          tel?.({
            phase: "FILLED",
            claimed: true,
            outcome: "FILLED",
            detail: "immediate_open_entry_recovery",
            tradeId: recovery.trade.goldHunterTradeId,
            brokerOrderId: recovery.trade.brokerOrderId ?? null,
            brokerPositionId: recovery.trade.brokerPositionId ?? null
          });
        }
      }
      if (!recoveredTrade || recoveredTrade.status === "PENDING_RECONCILIATION") {
        tel?.({
          phase: "PENDING_RECONCILIATION",
          claimed: true,
          outcome: "PENDING_RECONCILIATION",
          detail: result.errorCode ?? "broker_outcome_unknown",
          tradeId: goldHunterTradeId,
          brokerOrderId: result.trade?.brokerOrderId ?? null,
          brokerPositionId: result.trade?.brokerPositionId ?? null
        });
      }
    }

    // Durable trade row now owns max-open occupancy — release claim-time lease.
    if (result.outcome !== "BROKER_REJECTED") {
      await releaseGoldHunterMaxOpenSlot({
        ownerUid,
        reservationId: goldHunterTradeId
      }).catch(() => undefined);
    }

    return {
      ok: true,
      submitted: result.outcome !== "BROKER_SUBMIT_ERROR",
      outcome: result.outcome,
      signalId: opportunityId,
      tradeId: result.trade?.goldHunterTradeId ?? goldHunterTradeId
    };
  } catch (e) {
    await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
      state: "PENDING_RECONCILIATION",
      errorCode:
        e instanceof Error ? e.message.slice(0, 120) : "UNKNOWN_BROKER_OUTCOME"
    });
    tel?.({
      phase: "PENDING_RECONCILIATION",
      claimed: true,
      outcome: "PENDING_RECONCILIATION",
      detail: "unknown_broker_outcome",
      tradeId: goldHunterTradeId
    });
    return {
      ok: true,
      submitted: true,
      outcome: "PENDING_RECONCILIATION",
      signalId: opportunityId,
      tradeId: goldHunterTradeId,
      detail: "Unknown broker outcome — reconcile before any retry"
    };
  }
}

/** Ownership marker for broker correlation. */
export function goldHunterOwnershipComment(): string {
  return GH_ADMIN_STRATEGY_ID;
}
