/**
 * Gold Hunter Demo execution orchestrator.
 * Claim → size → protect → submit. Durable dedupe before broker.
 */
import { randomBytes } from "crypto";
import type { DemoMarketOrderResult } from "../broker/ctrader/openApiClient";
import type { SubmitDemoMarketOrderArgs } from "../broker/ctrader/demoOrderExecution";
import { fetchGoldHunterAccountSnapshot } from "./accountSnapshot";
import { computeGoldHunterCommittedCapital } from "./committedCapital";
import { submitGoldHunterDemoOrder } from "./demoExecutionAdapter";
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
import type { GoldHunterSelectedCandidate } from "./strategySelector";
import { listGoldHunterDemoTrades, todayNetPnlEur } from "./tradeStore";
import type { BrokerSymbol } from "../broker/domain";
import { GH_ADMIN_STRATEGY_ID } from "./types";
import { frozenGhFastSoakConfig } from "./abc";
import { plannedDailyLossBudgetEur } from "./riskSizing";

export type OrchestratorDeps = {
  isAdmin: boolean;
  marketOpen: boolean;
  feedFresh: boolean;
  /** Injected symbol catalogue row (required for sizing). */
  symbol: BrokerSymbol;
  placeOrder?: (args: SubmitDemoMarketOrderArgs) => Promise<DemoMarketOrderResult>;
  /** Simulate broker hang after claim (tests). */
  beforeBrokerSubmit?: () => Promise<void>;
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
 */
export async function attemptGoldHunterDemoExecution(
  ownerUid: string,
  candidate: GoldHunterSelectedCandidate,
  deps: OrchestratorDeps
): Promise<OrchestratorResult> {
  if (!candidate.depthExecutable) {
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — DEPTH INVALID"],
      signalId: candidate.signalId
    };
  }
  if (candidate.consumed) {
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — DUPLICATE SIGNAL"],
      signalId: candidate.signalId
    };
  }

  const config = await loadGoldHunterConfig(ownerUid);
  const meta: GoldHunterInstrumentMetadata = metadataFromBrokerSymbol(deps.symbol);
  if (!meta.complete) {
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — SIZING METADATA UNAVAILABLE"],
      signalId: candidate.signalId
    };
  }

  const protection = deriveGoldHunterInitialProtection({
    side: candidate.side,
    entryPrice: candidate.side === "BUY" ? candidate.ask : candidate.bid
  });
  if (!protection.ok) {
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — PROTECTION GEOMETRY NOT CONNECTED"],
      signalId: candidate.signalId
    };
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
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — COMMITTED CAPITAL UNKNOWN"],
      signalId: candidate.signalId
    };
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
    return {
      ok: false,
      submitted: false,
      blockers: [sized.blocker.startsWith("WAIT") ? sized.blocker : `WAIT — ${sized.blocker}`],
      signalId: candidate.signalId
    };
  }

  const account = await fetchGoldHunterAccountSnapshot({ ownerUid });
  if (
    account.freeMargin != null &&
    Number.isFinite(account.freeMargin) &&
    account.freeMargin <= 0
  ) {
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — CAPITAL LIMIT"],
      signalId: candidate.signalId
    };
  }

  const cfg = frozenGhFastSoakConfig();
  const spreadOk = candidate.spread <= cfg.maxSpread;

  const goldHunterTradeId = `GH-D-${randomBytes(4).toString("hex")}`;
  const clientOrderId = `gh_${candidate.signalId}`.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 50);

  const claim = await acquireGoldHunterSignalClaim({
    ownerUid,
    signalId: candidate.signalId,
    goldHunterTradeId,
    clientOrderId,
    setup: candidate.setup,
    side: candidate.side
  });
  if (!claim.ok) {
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — DUPLICATE SIGNAL"],
      signalId: candidate.signalId
    };
  }

  await updateGoldHunterSignalClaim(ownerUid, candidate.signalId, {
    state: "SUBMITTING"
  });

  if (deps.beforeBrokerSubmit) {
    try {
      await deps.beforeBrokerSubmit();
    } catch {
      await updateGoldHunterSignalClaim(ownerUid, candidate.signalId, {
        state: "PENDING_RECONCILIATION",
        errorCode: "BROKER_TIMEOUT_UNKNOWN"
      });
      return {
        ok: true,
        submitted: false,
        outcome: "PENDING_RECONCILIATION",
        signalId: candidate.signalId,
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
      signalId: candidate.signalId,
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
      await updateGoldHunterSignalClaim(ownerUid, candidate.signalId, {
        state: "BROKER_SUBMIT_ERROR",
        errorCode: result.blockers[0] ?? "GATES_BLOCKED"
      });
      return {
        ok: false,
        submitted: false,
        blockers: result.blockers,
        signalId: candidate.signalId
      };
    }

    if (result.outcome === "FILLED") {
      await updateGoldHunterSignalClaim(ownerUid, candidate.signalId, {
        state: "OPEN",
        brokerOrderId: result.trade?.brokerOrderId ?? null,
        brokerPositionId: result.trade?.brokerPositionId ?? null,
        goldHunterTradeId
      });
    } else if (result.outcome === "BROKER_REJECTED") {
      await updateGoldHunterSignalClaim(ownerUid, candidate.signalId, {
        state: "BROKER_REJECTED",
        errorCode: result.errorCode,
        brokerOrderId: result.trade?.brokerOrderId ?? null
      });
    } else if (result.outcome === "BROKER_SUBMIT_ERROR") {
      await updateGoldHunterSignalClaim(ownerUid, candidate.signalId, {
        state: "BROKER_SUBMIT_ERROR",
        errorCode: result.errorCode
      });
    } else if (result.outcome === "ACCEPTED_PENDING_FILL") {
      await updateGoldHunterSignalClaim(ownerUid, candidate.signalId, {
        state: "ACCEPTED",
        brokerOrderId: result.trade?.brokerOrderId ?? null,
        brokerPositionId: result.trade?.brokerPositionId ?? null
      });
    }

    return {
      ok: true,
      submitted: true,
      outcome: result.outcome,
      signalId: candidate.signalId,
      tradeId: result.trade?.goldHunterTradeId ?? goldHunterTradeId
    };
  } catch (e) {
    // Timeout / unknown after submit attempt — do not release claim for retry.
    await updateGoldHunterSignalClaim(ownerUid, candidate.signalId, {
      state: "PENDING_RECONCILIATION",
      errorCode:
        e instanceof Error ? e.message.slice(0, 120) : "UNKNOWN_BROKER_OUTCOME"
    });
    return {
      ok: true,
      submitted: true,
      outcome: "PENDING_RECONCILIATION",
      signalId: candidate.signalId,
      tradeId: goldHunterTradeId,
      detail: "Unknown broker outcome — reconcile before any retry"
    };
  }
}

/** Ownership marker for broker correlation. */
export function goldHunterOwnershipComment(): string {
  return GH_ADMIN_STRATEGY_ID;
}
