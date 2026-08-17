/**
 * Fail-closed projected daily-risk gate for Gold Hunter Demo.
 * Unknown / unsettled P/L never counts as zero.
 * Broker open positions must map to authoritative local risk records.
 */
import { getFirestoreDb } from "../firebaseAdmin";
import {
  countsTowardGoldHunterMaxOpen,
  listGoldHunterDemoTrades,
  todayNetPnlEur
} from "./tradeStore";
import {
  plannedDailyLossBudgetEur,
  plannedRiskBudgetEur
} from "./riskSizing";
import { isGoldHunterCloseSettlementPending } from "./closeSettlement";
import {
  isCorruptGoldHunterMfeMae,
  isValidGoldHunterEntryPrice
} from "./entryValidity";
import { frozenGhFastSoakConfig } from "./abc";
import {
  readGoldHunterBrokerOpenPositions,
  runGoldHunterReconcilePass
} from "./reconciliationRuntime";
import { validateGoldHunterRiskConfig } from "./configValidation";
import { reconcileGoldHunterMaxOpenLeaseOrphans } from "./maxOpenLease";
import {
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterAdminConfig,
  type GoldHunterDemoTrade,
  type GoldHunterWaitReason
} from "./types";

export type GoldHunterBrokerOpenPositionLite = {
  positionId: string;
  entryPrice?: number | null;
  label?: string | null;
  comment?: string | null;
  volumeLots?: number | null;
};

export type GoldHunterProjectedDailyRiskSnapshot = {
  dailyLossBudgetEur: number | null;
  brokerConfirmedRealizedNetPnlEur: number | null;
  realizedLossConsumedEur: number;
  openRiskEur: number;
  unresolvedRiskEur: number;
  proposedTradeRiskEur: number;
  projectedWorstCaseLossEur: number | null;
  remainingDailyRiskEur: number | null;
  brokerOpenGoldHunterCount: number;
  matchedBrokerGoldHunterCount: number;
  unmatchedBrokerGoldHunterCount: number;
  localRiskOccupyingCount: number;
  unresolvedSettlementCount: number;
  authoritative: boolean;
  blocker: GoldHunterWaitReason | null;
  allowed: boolean;
  detail: string | null;
};

export type BuildProjectedDailyRiskArgs = {
  config: GoldHunterAdminConfig;
  trades: GoldHunterDemoTrade[];
  /** Successful broker open-position read required for authority. */
  positionsReadOk: boolean;
  /** Authoritative broker GH opens (identity required for matching). */
  brokerOpenGoldHunterPositions?: GoldHunterBrokerOpenPositionLite[];
  /** @deprecated count-only without identity fails closed when > 0 */
  brokerOpenGoldHunterCount?: number;
  proposedTradeRiskEur: number;
  now?: Date;
};

function isGhDemo(t: GoldHunterDemoTrade): boolean {
  return t.strategy === GH_ADMIN_STRATEGY_ID && t.environment === "DEMO";
}

function isGoldHunterBrokerPosition(
  p: GoldHunterBrokerOpenPositionLite
): boolean {
  const label = String(p.label ?? "");
  const comment = String(p.comment ?? "");
  return (
    label.startsWith("GH-D-") ||
    comment.includes(GH_ADMIN_STRATEGY_ID) ||
    /gh_/i.test(label)
  );
}

/**
 * Unresolved exposure: close pending without net P/L, pending reconciliation,
 * invalid-entry opens, ACCEPTED_PENDING_FILL, etc. Each reserves one risk budget.
 */
export function isGoldHunterUnresolvedDailyRisk(
  t: GoldHunterDemoTrade
): boolean {
  if (!isGhDemo(t)) return false;
  if (t.status === "CLOSED") return false;
  if (t.status === "BROKER_REJECTED" || t.status === "BROKER_SUBMIT_ERROR") {
    return false;
  }
  if (isGoldHunterCloseSettlementPending(t.status)) {
    return t.netPnlEur == null || !Number.isFinite(t.netPnlEur);
  }
  if (t.status === "PENDING_RECONCILIATION") return true;
  if (t.status === "ACCEPTED_PENDING_FILL") return true;
  if (
    (t.status === "FILLED" ||
      t.status === "PROTECTED" ||
      t.result === "OPEN") &&
    !isValidGoldHunterEntryPrice(t.entry)
  ) {
    return true;
  }
  if (
    isCorruptGoldHunterMfeMae({
      mfe: t.mfe,
      mae: t.mae,
      hardStop: frozenGhFastSoakConfig().hardStop
    })
  ) {
    return true;
  }
  return false;
}

export function isGoldHunterProvenOpenRisk(t: GoldHunterDemoTrade): boolean {
  if (!isGhDemo(t)) return false;
  if (isGoldHunterUnresolvedDailyRisk(t)) return false;
  if (isGoldHunterCloseSettlementPending(t.status)) return false;
  if (!isValidGoldHunterEntryPrice(t.entry)) return false;
  return (
    t.status === "FILLED" ||
    t.status === "PROTECTED" ||
    t.result === "OPEN" ||
    t.status === "CLOSE_REQUESTED"
  );
}

function localMatchesBrokerPosition(
  trade: GoldHunterDemoTrade,
  pos: GoldHunterBrokerOpenPositionLite
): boolean {
  if (
    trade.brokerPositionId &&
    String(trade.brokerPositionId) === String(pos.positionId)
  ) {
    return true;
  }
  const label = String(pos.label ?? "");
  if (label && label === trade.goldHunterTradeId) return true;
  return false;
}

function isAuthoritativeLocalMatch(trade: GoldHunterDemoTrade): boolean {
  if (!isGhDemo(trade)) return false;
  if (!trade.brokerPositionId || String(trade.brokerPositionId).trim() === "") {
    return false;
  }
  if (!isValidGoldHunterEntryPrice(trade.entry)) return false;
  // Must still be in an open / risk-occupying state (or close-requested).
  if (trade.status === "CLOSED") return false;
  if (trade.status === "BROKER_REJECTED" || trade.status === "BROKER_SUBMIT_ERROR") {
    return false;
  }
  return (
    countsTowardGoldHunterMaxOpen(trade) ||
    trade.status === "CLOSE_REQUESTED" ||
    trade.result === "OPEN"
  );
}

export function matchGoldHunterBrokerOpenPositions(args: {
  brokerPositions: GoldHunterBrokerOpenPositionLite[];
  trades: GoldHunterDemoTrade[];
}): {
  brokerOpenGoldHunterCount: number;
  matchedBrokerGoldHunterCount: number;
  unmatchedBrokerGoldHunterCount: number;
  unmatchedPositionIds: string[];
} {
  const ghPositions = args.brokerPositions.filter(isGoldHunterBrokerPosition);
  let matched = 0;
  const unmatchedPositionIds: string[] = [];
  for (const pos of ghPositions) {
    const candidates = args.trades.filter((t) =>
      localMatchesBrokerPosition(t, pos)
    );
    const authoritative = candidates.find(isAuthoritativeLocalMatch);
    const entryOk =
      isValidGoldHunterEntryPrice(pos.entryPrice) ||
      (authoritative != null && isValidGoldHunterEntryPrice(authoritative.entry));
    if (authoritative && entryOk) {
      matched += 1;
    } else {
      unmatchedPositionIds.push(String(pos.positionId));
    }
  }
  return {
    brokerOpenGoldHunterCount: ghPositions.length,
    matchedBrokerGoldHunterCount: matched,
    unmatchedBrokerGoldHunterCount: unmatchedPositionIds.length,
    unmatchedPositionIds
  };
}

function blockedSnapshot(args: {
  dailyLossBudgetEur: number | null;
  proposed: number;
  blocker: GoldHunterWaitReason;
  detail: string;
  brokerOpenGoldHunterCount?: number;
  matchedBrokerGoldHunterCount?: number;
  unmatchedBrokerGoldHunterCount?: number;
  localRiskOccupyingCount?: number;
  unresolvedSettlementCount?: number;
  realizedLossConsumedEur?: number;
  openRiskEur?: number;
  unresolvedRiskEur?: number;
  projectedWorstCaseLossEur?: number | null;
  remainingDailyRiskEur?: number | null;
  brokerConfirmedRealizedNetPnlEur?: number | null;
  authoritative?: boolean;
}): GoldHunterProjectedDailyRiskSnapshot {
  return {
    dailyLossBudgetEur: args.dailyLossBudgetEur,
    brokerConfirmedRealizedNetPnlEur:
      args.brokerConfirmedRealizedNetPnlEur ?? null,
    realizedLossConsumedEur: args.realizedLossConsumedEur ?? 0,
    openRiskEur: args.openRiskEur ?? 0,
    unresolvedRiskEur: args.unresolvedRiskEur ?? 0,
    proposedTradeRiskEur: args.proposed,
    projectedWorstCaseLossEur: args.projectedWorstCaseLossEur ?? null,
    remainingDailyRiskEur: args.remainingDailyRiskEur ?? null,
    brokerOpenGoldHunterCount: args.brokerOpenGoldHunterCount ?? 0,
    matchedBrokerGoldHunterCount: args.matchedBrokerGoldHunterCount ?? 0,
    unmatchedBrokerGoldHunterCount: args.unmatchedBrokerGoldHunterCount ?? 0,
    localRiskOccupyingCount: args.localRiskOccupyingCount ?? 0,
    unresolvedSettlementCount: args.unresolvedSettlementCount ?? 0,
    authoritative: args.authoritative ?? false,
    blocker: args.blocker,
    allowed: false,
    detail: args.detail
  };
}

/**
 * Pure snapshot builder — no I/O.
 *
 * projectedWorstCaseLossEur =
 *   max(0, -realizedNet)
 *   + openRiskEur
 *   + unresolvedRiskEur
 *   + proposedTradeRiskEur
 */
export function buildGoldHunterProjectedDailyRiskSnapshot(
  args: BuildProjectedDailyRiskArgs
): GoldHunterProjectedDailyRiskSnapshot {
  const proposed = Math.max(0, args.proposedTradeRiskEur);
  const cfgCheck = validateGoldHunterRiskConfig(args.config);
  if (!cfgCheck.ok) {
    return blockedSnapshot({
      dailyLossBudgetEur: null,
      proposed,
      blocker: "WAIT — CONFIG INVALID",
      detail: cfgCheck.detail ?? "config_invalid"
    });
  }

  const dailyLossBudgetEur = plannedDailyLossBudgetEur(args.config);
  const unitRisk = plannedRiskBudgetEur(args.config);

  if (
    !Number.isFinite(dailyLossBudgetEur) ||
    !Number.isFinite(unitRisk) ||
    !Number.isFinite(proposed) ||
    dailyLossBudgetEur <= 0 ||
    unitRisk <= 0
  ) {
    return blockedSnapshot({
      dailyLossBudgetEur: Number.isFinite(dailyLossBudgetEur)
        ? dailyLossBudgetEur
        : null,
      proposed,
      blocker: "WAIT — CONFIG INVALID",
      detail: "risk_budget_non_finite"
    });
  }

  if (!args.positionsReadOk) {
    return blockedSnapshot({
      dailyLossBudgetEur,
      proposed,
      blocker: "WAIT — DAILY RISK UNKNOWN",
      detail: "broker_open_positions_read_failed",
      brokerOpenGoldHunterCount: args.brokerOpenGoldHunterCount ?? 0
    });
  }

  // Count-only without position identity cannot prove matching → fail closed.
  if (
    args.brokerOpenGoldHunterPositions == null &&
    (args.brokerOpenGoldHunterCount ?? 0) > 0
  ) {
    const n = args.brokerOpenGoldHunterCount ?? 0;
    return blockedSnapshot({
      dailyLossBudgetEur,
      proposed,
      blocker: "WAIT — DAILY RISK UNKNOWN",
      detail: "broker_open_positions_identity_unknown",
      brokerOpenGoldHunterCount: n,
      matchedBrokerGoldHunterCount: 0,
      unmatchedBrokerGoldHunterCount: n,
      authoritative: false
    });
  }

  const brokerPositions = args.brokerOpenGoldHunterPositions ?? [];

  const match = matchGoldHunterBrokerOpenPositions({
    brokerPositions,
    trades: args.trades
  });

  // Fail closed on broker/local mismatch or unmatched/corrupt broker exposure.
  if (
    match.unmatchedBrokerGoldHunterCount > 0 ||
    match.brokerOpenGoldHunterCount > match.matchedBrokerGoldHunterCount
  ) {
    return blockedSnapshot({
      dailyLossBudgetEur,
      proposed,
      blocker: "WAIT — DAILY RISK UNKNOWN",
      detail: `broker_local_mismatch_unmatched_${match.unmatchedBrokerGoldHunterCount}`,
      brokerOpenGoldHunterCount: match.brokerOpenGoldHunterCount,
      matchedBrokerGoldHunterCount: match.matchedBrokerGoldHunterCount,
      unmatchedBrokerGoldHunterCount: match.unmatchedBrokerGoldHunterCount,
      authoritative: false
    });
  }

  // maxOpen=1: any open broker GH position blocks a new entry.
  if (
    match.brokerOpenGoldHunterCount >= args.config.maxOpenTrades &&
    proposed > 0
  ) {
    // Still compute projected numbers for diagnostics, then block via unknown/limit path below
    // by treating open broker exposure as open risk — also explicit max-open style block
    // via daily-risk unknown when local occupancy cannot absorb it.
  }

  const gh = args.trades.filter(isGhDemo);
  const realizedNet = todayNetPnlEur(gh, args.now ?? new Date());
  if (!Number.isFinite(realizedNet)) {
    return blockedSnapshot({
      dailyLossBudgetEur,
      proposed,
      blocker: "WAIT — DAILY RISK UNKNOWN",
      detail: "realized_net_non_finite",
      brokerOpenGoldHunterCount: match.brokerOpenGoldHunterCount,
      matchedBrokerGoldHunterCount: match.matchedBrokerGoldHunterCount,
      unmatchedBrokerGoldHunterCount: match.unmatchedBrokerGoldHunterCount
    });
  }

  const realizedLossConsumedEur = Math.max(0, -realizedNet);
  const unresolved = gh.filter(isGoldHunterUnresolvedDailyRisk);
  const openProven = gh.filter(isGoldHunterProvenOpenRisk);
  const occupying = gh.filter(countsTowardGoldHunterMaxOpen);

  // Fail closed: each unresolved / open reserves a full risk budget unit.
  const unresolvedRiskEur = unresolved.length * unitRisk;
  // Include matched broker opens even if local open-proven count lags.
  const openCount = Math.max(openProven.length, match.matchedBrokerGoldHunterCount);
  const openRiskEur = openCount * unitRisk;

  const projectedWorstCaseLossEur =
    realizedLossConsumedEur + openRiskEur + unresolvedRiskEur + proposed;

  if (!Number.isFinite(projectedWorstCaseLossEur)) {
    return blockedSnapshot({
      dailyLossBudgetEur,
      proposed,
      blocker: "WAIT — CONFIG INVALID",
      detail: "projected_worst_case_non_finite",
      brokerOpenGoldHunterCount: match.brokerOpenGoldHunterCount,
      matchedBrokerGoldHunterCount: match.matchedBrokerGoldHunterCount,
      unmatchedBrokerGoldHunterCount: match.unmatchedBrokerGoldHunterCount,
      realizedLossConsumedEur,
      openRiskEur,
      unresolvedRiskEur
    });
  }

  const remainingDailyRiskEur = dailyLossBudgetEur - projectedWorstCaseLossEur;

  if (unresolved.length > 0) {
    const hasUnknownSettlementPnl = unresolved.some(
      (t) =>
        isGoldHunterCloseSettlementPending(t.status) &&
        (t.netPnlEur == null || !Number.isFinite(t.netPnlEur))
    );
    return {
      dailyLossBudgetEur,
      brokerConfirmedRealizedNetPnlEur: realizedNet,
      realizedLossConsumedEur,
      openRiskEur,
      unresolvedRiskEur,
      proposedTradeRiskEur: proposed,
      projectedWorstCaseLossEur,
      remainingDailyRiskEur,
      brokerOpenGoldHunterCount: match.brokerOpenGoldHunterCount,
      matchedBrokerGoldHunterCount: match.matchedBrokerGoldHunterCount,
      unmatchedBrokerGoldHunterCount: match.unmatchedBrokerGoldHunterCount,
      localRiskOccupyingCount: occupying.length,
      unresolvedSettlementCount: unresolved.length,
      authoritative: true,
      blocker: "WAIT — DAILY RISK UNKNOWN",
      allowed: false,
      detail: hasUnknownSettlementPnl
        ? "unresolved_close_settlement_pnl_unknown"
        : `unresolved_exposure_count_${unresolved.length}`
    };
  }

  // With maxOpen=1 any broker GH open must block a new proposed entry.
  if (match.brokerOpenGoldHunterCount >= 1 && proposed > 0) {
    return {
      dailyLossBudgetEur,
      brokerConfirmedRealizedNetPnlEur: realizedNet,
      realizedLossConsumedEur,
      openRiskEur,
      unresolvedRiskEur,
      proposedTradeRiskEur: proposed,
      projectedWorstCaseLossEur,
      remainingDailyRiskEur,
      brokerOpenGoldHunterCount: match.brokerOpenGoldHunterCount,
      matchedBrokerGoldHunterCount: match.matchedBrokerGoldHunterCount,
      unmatchedBrokerGoldHunterCount: match.unmatchedBrokerGoldHunterCount,
      localRiskOccupyingCount: occupying.length,
      unresolvedSettlementCount: unresolved.length,
      authoritative: true,
      blocker: "WAIT — MAX OPEN TRADES",
      allowed: false,
      detail: `broker_open_${match.brokerOpenGoldHunterCount}_blocks_new_entry`
    };
  }

  const overBudget = projectedWorstCaseLossEur > dailyLossBudgetEur;

  return {
    dailyLossBudgetEur,
    brokerConfirmedRealizedNetPnlEur: realizedNet,
    realizedLossConsumedEur,
    openRiskEur,
    unresolvedRiskEur,
    proposedTradeRiskEur: proposed,
    projectedWorstCaseLossEur,
    remainingDailyRiskEur,
    brokerOpenGoldHunterCount: match.brokerOpenGoldHunterCount,
    matchedBrokerGoldHunterCount: match.matchedBrokerGoldHunterCount,
    unmatchedBrokerGoldHunterCount: match.unmatchedBrokerGoldHunterCount,
    localRiskOccupyingCount: occupying.length,
    unresolvedSettlementCount: unresolved.length,
    authoritative: true,
    blocker: overBudget ? "WAIT — PROJECTED DAILY LOSS LIMIT" : null,
    allowed: !overBudget,
    detail: overBudget
      ? `projected_${projectedWorstCaseLossEur.toFixed(2)}_gt_budget_${dailyLossBudgetEur.toFixed(2)}`
      : null
  };
}

export type PreClaimProjectedRiskHooks = {
  reconcile?: (ownerUid: string) => Promise<{
    positionsReadOk: boolean;
    brokerOpenGoldHunterPositions: GoldHunterBrokerOpenPositionLite[];
  }>;
  listTrades?: (ownerUid: string) => Promise<GoldHunterDemoTrade[]>;
};

let preClaimHooks: PreClaimProjectedRiskHooks = {};

export function setGoldHunterPreClaimRiskHooksForTests(
  h: PreClaimProjectedRiskHooks
): void {
  preClaimHooks = h;
}

export function resetGoldHunterPreClaimRiskHooksForTests(): void {
  preClaimHooks = {};
}

/**
 * Reconcile → require broker open truth → settle what we can → rebuild snapshot.
 */
export async function evaluateGoldHunterPreClaimProjectedDailyRisk(args: {
  ownerUid: string;
  config: GoldHunterAdminConfig;
  proposedTradeRiskEur: number;
  reconcilePass?: PreClaimProjectedRiskHooks["reconcile"];
}): Promise<GoldHunterProjectedDailyRiskSnapshot> {
  const cfgCheck = validateGoldHunterRiskConfig(args.config);
  if (!cfgCheck.ok) {
    return buildGoldHunterProjectedDailyRiskSnapshot({
      config: args.config,
      trades: [],
      positionsReadOk: false,
      brokerOpenGoldHunterPositions: [],
      proposedTradeRiskEur: args.proposedTradeRiskEur
    });
  }

  const reconcile =
    args.reconcilePass ??
    preClaimHooks.reconcile ??
    (async (ownerUid: string) => {
      // Unit/memory backends: no live broker — use local trades only.
      if (!getFirestoreDb()) {
        return {
          positionsReadOk: true,
          brokerOpenGoldHunterPositions: [] as GoldHunterBrokerOpenPositionLite[]
        };
      }
      const pass = await runGoldHunterReconcilePass({
        ownerUid,
        force: true
      });
      let brokerOpenGoldHunterPositions: GoldHunterBrokerOpenPositionLite[] =
        [];
      if (pass.positionsReadOk) {
        const read = await readGoldHunterBrokerOpenPositions(ownerUid);
        if (read.ok) {
          brokerOpenGoldHunterPositions = read.positions
            .filter((p) =>
              isGoldHunterBrokerPosition({
                positionId: String(p.positionId),
                label: (p as { label?: string | null }).label,
                comment: (p as { comment?: string | null }).comment
              })
            )
            .map((p) => ({
              positionId: String(p.positionId),
              entryPrice: p.entryPrice ?? null,
              label: (p as { label?: string | null }).label ?? null,
              comment: (p as { comment?: string | null }).comment ?? null,
              volumeLots: p.volumeLots ?? null
            }));
        } else {
          return {
            positionsReadOk: false,
            brokerOpenGoldHunterPositions: []
          };
        }
      }
      return {
        positionsReadOk: pass.positionsReadOk,
        brokerOpenGoldHunterPositions
      };
    });

  const list =
    preClaimHooks.listTrades ??
    ((ownerUid: string) => listGoldHunterDemoTrades(ownerUid, { limit: 200 }));

  let positionsReadOk = false;
  let brokerOpenGoldHunterPositions: GoldHunterBrokerOpenPositionLite[] = [];
  try {
    const r = await reconcile(args.ownerUid);
    positionsReadOk = r.positionsReadOk;
    brokerOpenGoldHunterPositions = r.brokerOpenGoldHunterPositions ?? [];
  } catch {
    return buildGoldHunterProjectedDailyRiskSnapshot({
      config: args.config,
      trades: [],
      positionsReadOk: false,
      brokerOpenGoldHunterPositions: [],
      proposedTradeRiskEur: args.proposedTradeRiskEur
    });
  }

  const trades = await list(args.ownerUid);

  // Lease orphan cleanup uses exact per-holder claim lookup (getBySignalId /
  // getByTradeId) — never a capped claims list, and never treat lookup
  // failure as empty claims.
  await reconcileGoldHunterMaxOpenLeaseOrphans({
    ownerUid: args.ownerUid,
    positionsReadOk,
    brokerGhPositionIds: brokerOpenGoldHunterPositions.map((p) =>
      String(p.positionId)
    ),
    trades
  }).catch(() => undefined);

  return buildGoldHunterProjectedDailyRiskSnapshot({
    config: args.config,
    trades,
    positionsReadOk,
    brokerOpenGoldHunterPositions,
    proposedTradeRiskEur: args.proposedTradeRiskEur
  });
}
