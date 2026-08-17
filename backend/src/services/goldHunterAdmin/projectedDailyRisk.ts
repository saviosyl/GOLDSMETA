/**
 * Fail-closed projected daily-risk gate for Gold Hunter Demo.
 * Unknown / unsettled P/L never counts as zero.
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
import {
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterAdminConfig,
  type GoldHunterDemoTrade,
  type GoldHunterWaitReason
} from "./types";

export type GoldHunterProjectedDailyRiskSnapshot = {
  dailyLossBudgetEur: number;
  brokerConfirmedRealizedNetPnlEur: number | null;
  realizedLossConsumedEur: number;
  openRiskEur: number;
  unresolvedRiskEur: number;
  proposedTradeRiskEur: number;
  projectedWorstCaseLossEur: number | null;
  remainingDailyRiskEur: number | null;
  brokerOpenGoldHunterCount: number;
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
  brokerOpenGoldHunterCount: number;
  proposedTradeRiskEur: number;
  now?: Date;
};

function isGhDemo(t: GoldHunterDemoTrade): boolean {
  return t.strategy === GH_ADMIN_STRATEGY_ID && t.environment === "DEMO";
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
  const dailyLossBudgetEur = plannedDailyLossBudgetEur(args.config);
  const unitRisk = plannedRiskBudgetEur(args.config);
  const proposed = Math.max(0, args.proposedTradeRiskEur);

  if (!args.positionsReadOk) {
    return {
      dailyLossBudgetEur,
      brokerConfirmedRealizedNetPnlEur: null,
      realizedLossConsumedEur: 0,
      openRiskEur: 0,
      unresolvedRiskEur: 0,
      proposedTradeRiskEur: proposed,
      projectedWorstCaseLossEur: null,
      remainingDailyRiskEur: null,
      brokerOpenGoldHunterCount: args.brokerOpenGoldHunterCount,
      localRiskOccupyingCount: 0,
      unresolvedSettlementCount: 0,
      authoritative: false,
      blocker: "WAIT — DAILY RISK UNKNOWN",
      allowed: false,
      detail: "broker_open_positions_read_failed"
    };
  }

  const gh = args.trades.filter(isGhDemo);
  const realizedNet = todayNetPnlEur(gh, args.now ?? new Date());
  const realizedLossConsumedEur = Math.max(0, -realizedNet);

  const unresolved = gh.filter(isGoldHunterUnresolvedDailyRisk);
  const openProven = gh.filter(isGoldHunterProvenOpenRisk);
  const occupying = gh.filter(countsTowardGoldHunterMaxOpen);

  // Fail closed: each unresolved / open reserves a full risk budget unit.
  // Unknown exact P/L must not be treated as 0.
  const unresolvedRiskEur = unresolved.length * unitRisk;
  const openRiskEur = openProven.length * unitRisk;

  const projectedWorstCaseLossEur =
    realizedLossConsumedEur + openRiskEur + unresolvedRiskEur + proposed;
  const remainingDailyRiskEur = dailyLossBudgetEur - projectedWorstCaseLossEur;

  // Any unresolved / unknown P/L exposure → fail closed (never treat as 0).
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
      brokerOpenGoldHunterCount: args.brokerOpenGoldHunterCount,
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
    brokerOpenGoldHunterCount: args.brokerOpenGoldHunterCount,
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
    brokerOpenGoldHunterCount: number;
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
  const reconcile =
    args.reconcilePass ??
    preClaimHooks.reconcile ??
    (async (ownerUid: string) => {
      // Unit/memory backends: no live broker — use local trades only.
      if (!getFirestoreDb()) {
        return { positionsReadOk: true, brokerOpenGoldHunterCount: 0 };
      }
      const pass = await runGoldHunterReconcilePass({
        ownerUid,
        force: true
      });
      let brokerOpenGoldHunterCount = 0;
      if (pass.positionsReadOk) {
        const read = await readGoldHunterBrokerOpenPositions(ownerUid);
        if (read.ok) {
          brokerOpenGoldHunterCount = read.positions.filter((p) => {
            const label = String(
              (p as { label?: string | null }).label ?? ""
            );
            const comment = String(
              (p as { comment?: string | null }).comment ?? ""
            );
            return (
              label.startsWith("GH-D-") ||
              comment.includes(GH_ADMIN_STRATEGY_ID)
            );
          }).length;
        }
      }
      return {
        positionsReadOk: pass.positionsReadOk,
        brokerOpenGoldHunterCount
      };
    });

  const list =
    preClaimHooks.listTrades ??
    ((ownerUid: string) => listGoldHunterDemoTrades(ownerUid, { limit: 200 }));

  let positionsReadOk = false;
  let brokerOpenGoldHunterCount = 0;
  try {
    const r = await reconcile(args.ownerUid);
    positionsReadOk = r.positionsReadOk;
    brokerOpenGoldHunterCount = r.brokerOpenGoldHunterCount;
  } catch {
    return buildGoldHunterProjectedDailyRiskSnapshot({
      config: args.config,
      trades: [],
      positionsReadOk: false,
      brokerOpenGoldHunterCount: 0,
      proposedTradeRiskEur: args.proposedTradeRiskEur
    });
  }

  const trades = await list(args.ownerUid);
  return buildGoldHunterProjectedDailyRiskSnapshot({
    config: args.config,
    trades,
    positionsReadOk,
    brokerOpenGoldHunterCount,
    proposedTradeRiskEur: args.proposedTradeRiskEur
  });
}
