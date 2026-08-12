/**
 * Compact qualification evaluation log — why setups counted or were rejected.
 * Path: users/{uid}/autotradeEvaluationLog/{id}
 * Does not alter qualification counters.
 */

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { randomBytes } from "crypto";

export type EvaluationOutcome = "QUALIFIED" | "REJECTED" | "IGNORED";

export type EvaluationRecord = {
  id: string;
  uid: string;
  accountMasked: string | null;
  at: string;
  tradingDay: string;
  stage: string;
  direction: string;
  signalIdHash: string;
  /** Original decision id when available (not hashed). */
  decisionId?: string | null;
  confidence: number | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  spread: number | null;
  maxSpread: number | null;
  outcome: EvaluationOutcome;
  reasonCode: string;
  reasonLabel: string;
  passed: string[];
  failed: string[];
  /** Pipeline stage results for missed-opportunity audit (optional). */
  pipeline?: {
    confirmation?: string | null;
    session?: string | null;
    news?: string | null;
    quoteAge?: string | null;
    dailyLimits?: string | null;
    openPositions?: string | null;
    armedCandidate?: string | null;
    executionAuthority?: string | null;
    brokerSubmissionAttempted?: boolean;
    brokerOrderIdMasked?: string | null;
  };
  /** One human-readable final reason when not submitted. */
  finalReason?: string | null;
};

function col(uid: string) {
  return getFirestore().collection(`users/${uid}/autotradeEvaluationLog`);
}

function hashSignal(signalId: string): string {
  // Short non-reversible display hash — not a secret token.
  let h = 0;
  for (let i = 0; i < signalId.length; i++) h = (h * 31 + signalId.charCodeAt(i)) >>> 0;
  return `sig_${h.toString(16).slice(0, 8)}`;
}

export function reasonLabelFor(code: string): string {
  const map: Record<string, string> = {
    NOT_ACTIONABLE: "WAIT/HOLD signal",
    DUPLICATE_SIGNAL: "Duplicate setup",
    INCOMPLETE_GEOMETRY: "Incomplete trade geometry",
    GEOMETRY_DIRECTION_INVALID: "Invalid entry / SL / TP geometry",
    QUOTE_UNAVAILABLE: "Quote unavailable",
    MARKET_NOT_OPEN: "Market closed",
    QUOTE_STALE: "Stale quote",
    QUOTE_AGE: "Quote freshness gate",
    SPREAD_TOO_WIDE: "Spread guard",
    CONFIDENCE_TOO_LOW: "Confidence below minimum",
    RR_TOO_LOW: "Risk:Reward below minimum",
    DAILY_TRADE_LIMIT: "Daily trade limit reached",
    DAILY_LOSS_LIMIT: "Daily loss limit reached",
    COOLDOWN_ACTIVE: "Cooldown active",
    CONSECUTIVE_LOSS_PAUSE: "Consecutive-loss pause",
    MAX_OPEN_POSITIONS: "Max open positions reached",
    NEWS_GUARD: "News guard",
    SESSION_BLOCKED: "Session blocked",
    EMERGENCY_STOP: "Emergency Stop",
    ENTRIES_PAUSED: "AutoTrade paused",
    PROFIT_TARGET: "Daily profit target reached",
    PROFIT_PROTECTION: "Daily profit protection",
    PREVIEW_COUNTED: "Qualified preview",
    CONTROLLED_OPENED: "Controlled Demo trade opened",
    ONE_POSITION_RULE: "One Gold position at a time",
    WAIT_HOLD: "WAIT/HOLD signal",
    CANDIDATE_ARMED: "Setup armed — waiting for entry confirmation",
    CANDIDATE_WAITING_CONFIRMATION: "Armed setup still waiting for confirmation",
    CANDIDATE_INVALIDATED: "Armed setup invalidated",
    CANDIDATE_INVALIDATED_OPPOSITE: "Armed setup cancelled by opposite signal",
    CANDIDATE_INVALIDATED_AUTOTRADE_OFF: "Armed setup cancelled — AutoTrade off",
    CANDIDATE_INVALIDATED_STALE:
      "Armed candidate expired — no confirmation within window",
    ENTRY_CONFIRMATION_RECEIVED: "Entry confirmation received",
    EXECUTION_ALREADY_ATTEMPTED: "Duplicate execution suppressed",
    FINAL_SAFETY_FAILED: "Final safety check rejected execution",
    QUALIFICATION_NOT_STARTED: "Demo Auto qualification was not started",
    EXECUTION_AUTHORITY_OFF: "Demo Auto authority OFF",
    BROKER_SUBMITTED: "Broker Demo order submitted",
    BROKER_BOUNDARY_REACHED: "Reached Demo order submission boundary",
    PLAN_REFRESH_UNAVAILABLE:
      "Session plan refresh unavailable — still monitoring armed candidate",
    FAST_CONFIRMATION_RECEIVED: "A+ fast confirmation — ready to execute",
    ARMED_WINDOW_EXPIRED: "Armed confirmation window expired",
    INVALIDATION_PRICE_BREACHED: "Invalidation / stop price breached",
    TIER_BELOW_A: "Setup score below A threshold (ACTIVE_DEMO)",
    RISK_MULTIPLIER_INVALID: "Demo risk multiplier invalid — fail closed",
    AUTOTRADE_INTENT_OFF: "Demo Auto intent OFF — armed thesis cancelled",
    TRADING_OAUTH_REQUIRED: "Trading OAuth scope required",
    DEMO_ACCOUNT_NOT_SELECTED: "Demo account not selected",
    DEMO_SUBMISSION_FLAG_OFF: "Demo submission flag off"
  };
  return map[code] ?? code.replace(/_/g, " ").toLowerCase();
}

/** Human-readable Activity line, e.g. "BUY 91/100 skipped — Demo Auto qualification was not started." */
export function formatEvaluationActivityMessage(row: {
  direction: string;
  confidence: number | null;
  outcome: EvaluationOutcome;
  reasonCode: string;
  reasonLabel?: string | null;
  finalReason?: string | null;
}): string {
  const fr = String(row.finalReason || "").trim();
  // Prefer rich ACTIVE_DEMO opportunity-engine labels written into finalReason.
  if (
    fr &&
    (fr.includes("A+") ||
      fr.includes("ARMED") ||
      fr.includes("FAST CONFIRMATION") ||
      fr.includes("ORDER SUBMITTED") ||
      fr.includes("EXPIRED") ||
      fr.includes("CANCELLED") ||
      fr.includes("PLAN_REFRESH_UNAVAILABLE") ||
      fr.includes("PLAN REFRESH UNAVAILABLE") ||
      fr.includes("waiting 5M") ||
      fr.includes("bars remaining"))
  ) {
    return fr;
  }
  const dir = String(row.direction || "WAIT").toUpperCase();
  const score =
    row.confidence != null && Number.isFinite(row.confidence)
      ? `${Math.round(row.confidence)}/100`
      : null;
  const head = score ? `${dir} ${score}` : dir;
  if (row.outcome === "QUALIFIED" && row.reasonCode === "BROKER_SUBMITTED") {
    return `${head} submitted — Demo order placed.`;
  }
  const why =
    row.finalReason ||
    row.reasonLabel ||
    reasonLabelFor(row.reasonCode);
  return `${head} skipped — ${why}.`;
}

export async function appendEvaluation(
  partial: Omit<EvaluationRecord, "id" | "signalIdHash"> & { signalId: string }
): Promise<EvaluationRecord> {
  const id = `ev_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const reasonLabel = partial.reasonLabel || reasonLabelFor(partial.reasonCode);
  const row: EvaluationRecord = {
    id,
    uid: partial.uid,
    accountMasked: partial.accountMasked,
    at: partial.at,
    tradingDay: partial.tradingDay,
    stage: partial.stage,
    direction: partial.direction,
    signalIdHash: hashSignal(partial.signalId),
    decisionId: partial.decisionId ?? null,
    confidence: partial.confidence,
    entry: partial.entry,
    stopLoss: partial.stopLoss,
    takeProfit: partial.takeProfit,
    riskReward: partial.riskReward,
    spread: partial.spread,
    maxSpread: partial.maxSpread,
    outcome: partial.outcome,
    reasonCode: partial.reasonCode,
    reasonLabel,
    passed: partial.passed.slice(0, 24),
    failed: partial.failed.slice(0, 24),
    pipeline: partial.pipeline,
    finalReason:
      partial.finalReason ??
      (partial.outcome === "QUALIFIED" ? null : reasonLabel)
  };
  await col(partial.uid).doc(id).set(row);
  // Best-effort prune marker (no hard delete of qualification).
  void FieldValue;
  return row;
}

export async function listRecentEvaluations(
  uid: string,
  limit = 40
): Promise<EvaluationRecord[]> {
  const snap = await col(uid).orderBy("at", "desc").limit(Math.min(100, Math.max(1, limit))).get();
  return snap.docs.map((d) => d.data() as EvaluationRecord);
}

export async function countEvaluationsForDay(
  uid: string,
  tradingDay: string
): Promise<{ evaluated: number; qualified: number; rejected: number }> {
  const snap = await col(uid).where("tradingDay", "==", tradingDay).limit(500).get();
  let evaluated = 0;
  let qualified = 0;
  let rejected = 0;
  for (const d of snap.docs) {
    const row = d.data() as EvaluationRecord;
    if (row.outcome === "IGNORED") continue;
    evaluated += 1;
    if (row.outcome === "QUALIFIED") qualified += 1;
    else if (row.outcome === "REJECTED") rejected += 1;
  }
  return { evaluated, qualified, rejected };
}
