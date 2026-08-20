/**
 * Final CURRENT loss-safety revalidation immediately before broker transport.
 * Blocks NewOrder when the live selector has an active loss guard / anti-churn reject.
 * Does not invent R. Does not retune strategy.
 */
import {
  getGoldHunterStrategySelector,
  type GoldHunterSelectedCandidate
} from "./strategySelector";

export const GH_FINAL_LOSS_SAFETY_BLOCKERS = [
  "WAIT_LOSS_STREAK_GUARD",
  "WAIT_LOSS_CIRCUIT_BREAKER",
  "WAIT_REALISED_R_INCOMPLETE"
] as const;

export type GoldHunterFinalLossSafetyResult = {
  ok: boolean;
  rejectionReason: string | null;
  detail: string | null;
};

/**
 * Re-check CURRENT selector loss / anti-churn state at the last local moment
 * before ProtoOA NewOrder. Queued candidates must not bypass a guard that
 * armed after they were selected.
 */
export function evaluateGoldHunterFinalLossSafetyGate(args: {
  ownerUid: string;
  side: "BUY" | "SELL";
  mid: number;
  atMs?: number;
  signedImbalance1s?: number | null;
  midVel250?: number | null;
  opportunityId?: string | null;
}): GoldHunterFinalLossSafetyResult {
  const sel = getGoldHunterStrategySelector(args.ownerUid);
  const atMs = args.atMs ?? Date.now();
  const gate = sel.evaluateCurrentLossSafetyGate({
    side: args.side,
    atMs,
    mid: args.mid,
    opportunityId: args.opportunityId ?? null,
    signedImbalance1s: args.signedImbalance1s ?? undefined,
    midVel250: args.midVel250 ?? undefined
  });
  if (gate.ok) {
    return { ok: true, rejectionReason: null, detail: null };
  }
  const reason = gate.rejectionReason ?? "WAIT — LOSS ANTI-CHURN";
  return {
    ok: false,
    rejectionReason: reason,
    detail: "final_pretransport_loss_safety"
  };
}

/** Convenience: pull mid/imbalance/vel from a selected candidate when available. */
export function evaluateGoldHunterFinalLossSafetyForCandidate(args: {
  ownerUid: string;
  candidate: Pick<
    GoldHunterSelectedCandidate,
    "side" | "bid" | "ask" | "opportunityId" | "signalId"
  > & {
    signedImbalance1s?: number | null;
    midVel250?: number | null;
  };
  atMs?: number;
}): GoldHunterFinalLossSafetyResult {
  const mid =
    Number.isFinite(args.candidate.bid) && Number.isFinite(args.candidate.ask)
      ? (args.candidate.bid + args.candidate.ask) / 2
      : args.candidate.side === "BUY"
        ? args.candidate.ask
        : args.candidate.bid;
  return evaluateGoldHunterFinalLossSafetyGate({
    ownerUid: args.ownerUid,
    side: args.candidate.side,
    mid,
    atMs: args.atMs,
    signedImbalance1s: args.candidate.signedImbalance1s ?? null,
    midVel250: args.candidate.midVel250 ?? null,
    opportunityId:
      args.candidate.opportunityId || args.candidate.signalId || null
  });
}
