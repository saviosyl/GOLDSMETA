/**
 * Gold Hunter Demo execution orchestrator.
 * Claim → size → protect → submit. Durable dedupe before broker.
 * Claim key = opportunity identity (candidate.signalId / opportunityId).
 */
import { randomBytes } from "crypto";
import type { DemoMarketOrderResult } from "../broker/ctrader/openApiClient";
import type { SubmitDemoMarketOrderArgs } from "../broker/ctrader/demoOrderExecution";
import { fetchGoldHunterAccountSnapshot } from "./accountSnapshot";
import { assertGoldHunterCandidateFresh } from "./candidateFreshness";
import { computeGoldHunterCommittedCapital } from "./committedCapital";
import { submitGoldHunterDemoOrder } from "./demoExecutionAdapter";
import { registerGoldHunterOpenPositionForOwner } from "./demoPositionManager";
import { loadGoldHunterConfig } from "./configStore";
import {
  metadataFromBrokerSymbol,
  type GoldHunterInstrumentMetadata
} from "./instrumentMetadata";
import { deriveGoldHunterInitialProtection } from "./protectionGeometry";
import { sizeGoldHunterDemoLots } from "./riskSizing";
import {
  acquireGoldHunterSignalClaim,
  updateGoldHunterSignalClaim
} from "./signalClaimStore";
import {
  getGoldHunterStrategySelector,
  type GoldHunterSelectedCandidate
} from "./strategySelector";
import { listGoldHunterDemoTrades, todayNetPnlEur } from "./tradeStore";
import type { BrokerSymbol } from "../broker/domain";
import { GH_ADMIN_STRATEGY_ID } from "./types";
import { frozenGhFastSoakConfig } from "./abc";
import { plannedDailyLossBudgetEur } from "./riskSizing";

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

export type OrchestratorDeps = {
  isAdmin: boolean;
  marketOpen: boolean;
  feedFresh: boolean;
  /** Injected symbol catalogue row (required for sizing). */
  symbol: BrokerSymbol;
  placeOrder?: (args: SubmitDemoMarketOrderArgs) => Promise<DemoMarketOrderResult>;
  /** Simulate broker hang after claim (tests). */
  beforeBrokerSubmit?: () => Promise<void>;
  /** Override freshness gate (production uses assertGoldHunterCandidateFresh). */
  assertFresh?: typeof assertGoldHunterCandidateFresh;
  /** Optional execution telemetry (Gold Hunter Admin diagnostics). */
  onTelemetry?: OrchestratorTelemetryHook;
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
  if (!fresh.ok) {
    return block(fresh.blocker, fresh.detail);
  }

  const config = await loadGoldHunterConfig(ownerUid);
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

  const openTrades = await listGoldHunterDemoTrades(ownerUid, {
    limit: 50,
    openOnly: true
  });
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

  const account = await fetchGoldHunterAccountSnapshot({ ownerUid });
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

  tel?.({ phase: "CLAIMING", tradeId: goldHunterTradeId });

  const claim = await acquireGoldHunterSignalClaim({
    ownerUid,
    signalId: opportunityId,
    goldHunterTradeId,
    clientOrderId,
    setup: candidate.setup,
    side: candidate.side
  });
  if (!claim.ok) {
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

  await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
    state: "SUBMITTING"
  });
  tel?.({ phase: "SUBMITTING", claimed: true, tradeId: goldHunterTradeId });

  if (deps.beforeBrokerSubmit) {
    try {
      await deps.beforeBrokerSubmit();
    } catch {
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

  const todayPnl = todayNetPnlEur(
    await listGoldHunterDemoTrades(ownerUid, { limit: 200 })
  );
  const dailyLossOk = todayPnl > -plannedDailyLossBudgetEur(config);

  try {
    const result = await submitGoldHunterDemoOrder({
      ownerUid,
      isAdmin: deps.isAdmin,
      side: candidate.side,
      lots: sized.lots,
      stopLoss: protection.stopPrice,
      takeProfit: null,
      entryHint: protection.entryPrice,
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
      placeOrder: deps.placeOrder
    });

    if (!result.ok) {
      await updateGoldHunterSignalClaim(ownerUid, opportunityId, {
        state: "BROKER_SUBMIT_ERROR",
        errorCode: result.blockers[0] ?? "GATES_BLOCKED"
      });
      tel?.({
        phase: "BROKER_SUBMIT_ERROR",
        claimed: true,
        outcome: "BROKER_SUBMIT_ERROR",
        blocker: result.blockers[0] ?? "GATES_BLOCKED",
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
        brokerPositionId: result.trade?.brokerPositionId ?? null
      });
      tel?.({
        phase: "ACCEPTED_PENDING_FILL",
        claimed: true,
        outcome: "ACCEPTED_PENDING_FILL",
        tradeId: goldHunterTradeId,
        brokerOrderId: result.trade?.brokerOrderId ?? null,
        brokerPositionId: result.trade?.brokerPositionId ?? null
      });
    }

    return {
      ok: true,
      submitted: true,
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
