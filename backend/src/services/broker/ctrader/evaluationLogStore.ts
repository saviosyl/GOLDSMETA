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
  } | null;
  /** One human-readable final reason when not submitted. */
  finalReason?: string | null;
  /** Optional overnight Demo run correlation id. */
  overnightRunId?: string | null;
  /** FAST_AUTOTRADE_V1 missed-opportunity diagnostics. */
  fastTelemetry?: FastWaitTelemetry | null;
};

export type FastWaitTelemetry = {
  strategyId?: string;
  regime?: string | null;
  bias?: string | null;
  setupType?: string | null;
  trigger?: string | null;
  qualityScore?: number | null;
  grade?: string | null;
  m1Availability?: string | null;
  m1CompletedAtMs?: number | null;
  m1AgeMs?: number | null;
  tradeSpaceOk?: boolean | null;
  extended?: boolean | null;
  waitReason?: string | null;
  spread?: number | null;
  quoteAgeSeconds?: number | null;
  candleKey?: string | null;
  accepted?: string[];
  missing?: string[];
  supporting?: string[];
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
    BROKER_UNIT_MAPPING_REQUIRED:
      "Pepperstone XAUUSD unit mapping required — fail closed",
    RISK_MULTIPLIER_INVALID: "Demo risk multiplier invalid — fail closed",
    AUTOTRADE_INTENT_OFF: "Demo Auto intent OFF — armed thesis cancelled",
    TRADING_OAUTH_REQUIRED: "Trading OAuth scope required",
    DEMO_ACCOUNT_NOT_SELECTED: "Demo account not selected",
    DEMO_SUBMISSION_FLAG_OFF: "Demo submission flag off",
    OVERNIGHT_WINDOW_ENDED: "Demo overnight entry window ended",
    WAIT_NO_SETUP: "No valid FAST setup",
    WAIT_CHOP: "CHOP regime — waiting",
    WAIT_LOW_MOMENTUM: "Momentum too weak",
    WAIT_SPREAD: "Spread guard",
    WAIT_RISK_LIMIT: "Risk limit",
    WAIT_NEWS: "News guard",
    WAIT_EXTENDED: "Move already extended",
    WAIT_NO_TRADE_SPACE: "Not enough room to target",
    WAIT_TRIGGER_NOT_CONFIRMED: "Setup found — trigger not confirmed",
    WAIT_DUPLICATE_SETUP: "Duplicate setup",
    WAIT_REENTRY_DELAY: "Re-entry delay",
    WAIT_SAME_CANDLE: "Same-candle re-entry blocked",
    WAIT_NEUTRAL_BIAS: "No directional bias",
    WAIT_LOW_QUALITY: "Quality below entry grade",
    WAIT_DANGEROUS: "DANGEROUS regime",
    WAIT_STALE_PRICE: "Stale price",
    WAIT_MARKET_CLOSED: "Market closed",
    WAIT_MALFORMED_DATA: "Malformed market data",
    WAIT_PENDING_TIMEOUT: "Pending state timed out",
    WAIT_FLAP_GUARD: "Signal flap guard",
    WAIT_M1_UNAVAILABLE: "Completed 1-minute candle unavailable",
    WAIT_M1_STALE: "Completed 1-minute candle is stale",
    FAST_AUTOTRADE_V1_DEMO_ONLY: "FAST_AUTOTRADE_V1 is Demo-only — Live order blocked"
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

/** Firestore rejects `undefined` fields — strip them so FAST wait rows persist. */
export function omitUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item: unknown) => item !== undefined)
      .map((item: unknown) => omitUndefinedDeep(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      out[key] = omitUndefinedDeep(entry);
    }
    return out;
  }
  return value;
}

export function fastWaitDedupeKey(args: {
  decisionId?: string | null;
  reasonCode: string;
  candleKey?: string | null;
  m1CompletedAtMs?: number | null;
}): string {
  const m1 =
    args.m1CompletedAtMs != null && Number.isFinite(args.m1CompletedAtMs)
      ? String(args.m1CompletedAtMs)
      : "";
  return `${args.decisionId ?? ""}|${args.reasonCode}|${args.candleKey ?? ""}|${m1}`;
}

/** Same decision + same completed M1 + same WAIT reason → do not write again. */
export function isDuplicateFastWaitEval(
  recent: Array<Pick<EvaluationRecord, "decisionId" | "reasonCode" | "fastTelemetry">>,
  next: {
    decisionId?: string | null;
    reasonCode: string;
    candleKey?: string | null;
    m1CompletedAtMs?: number | null;
  }
): boolean {
  const key = fastWaitDedupeKey(next);
  return recent.some(
    (row) =>
      row.fastTelemetry != null &&
      fastWaitDedupeKey({
        decisionId: row.decisionId,
        reasonCode: row.reasonCode,
        candleKey: row.fastTelemetry.candleKey ?? null,
        m1CompletedAtMs: row.fastTelemetry.m1CompletedAtMs ?? null
      }) === key
  );
}

export async function appendEvaluation(
  partial: Omit<EvaluationRecord, "id" | "signalIdHash"> & { signalId: string }
): Promise<EvaluationRecord> {
  const id = `ev_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const reasonLabel = partial.reasonLabel || reasonLabelFor(partial.reasonCode);
  const row = omitUndefinedDeep({
    id,
    uid: partial.uid,
    accountMasked: partial.accountMasked ?? null,
    at: partial.at,
    tradingDay: partial.tradingDay,
    stage: partial.stage,
    direction: partial.direction,
    signalIdHash: hashSignal(partial.signalId),
    decisionId: partial.decisionId ?? null,
    confidence: partial.confidence ?? null,
    entry: partial.entry ?? null,
    stopLoss: partial.stopLoss ?? null,
    takeProfit: partial.takeProfit ?? null,
    riskReward: partial.riskReward ?? null,
    spread: partial.spread ?? null,
    maxSpread: partial.maxSpread ?? null,
    outcome: partial.outcome,
    reasonCode: partial.reasonCode,
    reasonLabel,
    passed: (partial.passed ?? []).slice(0, 24),
    failed: (partial.failed ?? []).slice(0, 24),
    pipeline: partial.pipeline ?? null,
    finalReason:
      partial.finalReason ??
      (partial.outcome === "QUALIFIED" ? null : reasonLabel),
    overnightRunId: partial.overnightRunId ?? null,
    fastTelemetry: partial.fastTelemetry ?? null
  }) as EvaluationRecord;
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
