/**
 * Gold Hunter committed / available allocation from GH-owned Demo positions.
 * Never assume committed=0 when open exposure exists but cannot be priced.
 */
import type { GoldHunterAdminConfig, GoldHunterDemoTrade } from "./types";

export type CommittedCapitalResult = {
  committedEur: number | null;
  availableEur: number | null;
  known: boolean;
  basis: "OPEN_TRADE_RISK_BUDGET" | "NONE" | "UNAVAILABLE";
  note: string | null;
};

/**
 * Conservative commitment: each open GH trade reserves one risk budget unit.
 * If open trades exist but risk budget invalid → unavailable (fail closed for new orders).
 */
export function computeGoldHunterCommittedCapital(args: {
  config: GoldHunterAdminConfig;
  openTrades: GoldHunterDemoTrade[];
  /** Optional broker-reported used margin attributed to GH positions. */
  brokerUsedMarginEur?: number | null;
}): CommittedCapitalResult {
  const open = args.openTrades.filter(
    (t) => t.status !== "CLOSED" && (t.result === "OPEN" || t.result == null)
  );
  const riskBudget =
    (args.config.allocatedCapitalEur * args.config.riskPerTradePct) / 100;

  if (open.length === 0) {
    return {
      committedEur: 0,
      availableEur: Math.max(0, args.config.allocatedCapitalEur),
      known: true,
      basis: "NONE",
      note: null
    };
  }

  if (!(riskBudget > 0) || !Number.isFinite(riskBudget)) {
    return {
      committedEur: null,
      availableEur: null,
      known: false,
      basis: "UNAVAILABLE",
      note: "Open GH positions exist but risk budget cannot be computed"
    };
  }

  const byRisk = open.length * riskBudget;
  const byMargin =
    args.brokerUsedMarginEur != null &&
    Number.isFinite(args.brokerUsedMarginEur) &&
    args.brokerUsedMarginEur >= 0
      ? args.brokerUsedMarginEur
      : null;
  // Conservative: take the larger of risk-budget reserve vs broker used margin.
  const committed = byMargin != null ? Math.max(byRisk, byMargin) : byRisk;
  const available = Math.max(0, args.config.allocatedCapitalEur - committed);
  return {
    committedEur: committed,
    availableEur: available,
    known: true,
    basis: "OPEN_TRADE_RISK_BUDGET",
    note: byMargin != null ? "max(riskBudget*open, brokerUsedMargin)" : null
  };
}
