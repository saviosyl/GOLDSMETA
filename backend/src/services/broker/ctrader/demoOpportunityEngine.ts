/**
 * ACTIVE_DEMO opportunity engine — Pepperstone Demo only.
 *
 * Separates setup thesis from session-plan refresh, defines A+/A tiers,
 * short armed confirmation window, Asia experimental risk, and risk multipliers.
 *
 * Setup score is NOT win probability.
 * Live execution remains impossible via existing hard locks.
 *
 * Session-plan semantics (GoldMeta):
 * - NO_VALID_PLAN — external plan absent/incomplete refresh. Soft for an
 *   already-armed thesis → PLAN_REFRESH_UNAVAILABLE (keep monitoring).
 * - NO_TRADE — hard/non-actionable (e.g. mismatch / chart-role). Invalidates.
 * - INVALIDATED / EXPIRED — hard invalidators.
 */

import type { SessionName } from "./sessionGuard";
import { currentSessionUtc } from "./sessionGuard";

/** Demo opportunity mode. STRICT = prior behaviour; ACTIVE_DEMO = this engine. */
export type DemoOpportunityMode = "STRICT" | "ACTIVE_DEMO";

export type DemoSetupTier = "A_PLUS" | "A" | "BELOW";

export type DemoOpportunityConfig = {
  mode: DemoOpportunityMode;
  /** Number of completed 5M bars to wait for confirmation (default 3 = 15m). */
  armedConfirmationBars5m: number;
  aPlusMinScore: number;
  aMinScore: number;
  /** Allow Asia session for A+/A in ACTIVE_DEMO. */
  asiaExperimentalEnabled: boolean;
  riskMultiplierAPlusMajor: number;
  riskMultiplierAMajor: number;
  riskMultiplierAsia: number;
};

export const DEFAULT_DEMO_OPPORTUNITY_CONFIG: DemoOpportunityConfig = {
  mode: "ACTIVE_DEMO",
  armedConfirmationBars5m: 3,
  aPlusMinScore: 90,
  aMinScore: 80,
  asiaExperimentalEnabled: true,
  riskMultiplierAPlusMajor: 1.0,
  riskMultiplierAMajor: 0.75,
  riskMultiplierAsia: 0.5
};

function parseBoundedNumber(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function parseRiskMult(raw: string | undefined, fallback: number): number {
  // Experimental PR: multipliers must be >0 and <=1.
  return parseBoundedNumber(raw, fallback, Number.EPSILON, 1);
}

/**
 * Load Demo opportunity config from env with validated bounds.
 * Invalid values fail closed to defaults (never invent >1 risk mult).
 */
export function loadDemoOpportunityConfig(
  source: NodeJS.ProcessEnv = process.env
): DemoOpportunityConfig {
  const modeRaw = String(source.DEMO_OPPORTUNITY_MODE ?? "ACTIVE_DEMO")
    .trim()
    .toUpperCase();
  const mode: DemoOpportunityMode =
    modeRaw === "STRICT" ? "STRICT" : "ACTIVE_DEMO";

  const bars = Math.floor(
    parseBoundedNumber(source.DEMO_ARMED_CONFIRMATION_BARS_5M, 3, 1, 12)
  );
  let aPlusMinScore = Math.floor(
    parseBoundedNumber(source.DEMO_A_PLUS_MIN_SCORE, 90, 50, 100)
  );
  let aMinScore = Math.floor(
    parseBoundedNumber(source.DEMO_A_MIN_SCORE, 80, 50, 100)
  );
  // Enforce A minimum < A+ minimum; fail closed to defaults if inverted.
  if (!(aMinScore < aPlusMinScore)) {
    aPlusMinScore = DEFAULT_DEMO_OPPORTUNITY_CONFIG.aPlusMinScore;
    aMinScore = DEFAULT_DEMO_OPPORTUNITY_CONFIG.aMinScore;
  }

  const asiaRaw = String(source.DEMO_ASIA_EXPERIMENTAL_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  const asiaExperimentalEnabled =
    asiaRaw === "0" || asiaRaw === "false" || asiaRaw === "off"
      ? false
      : true;

  return {
    mode,
    armedConfirmationBars5m: bars,
    aPlusMinScore,
    aMinScore,
    asiaExperimentalEnabled,
    riskMultiplierAPlusMajor: parseRiskMult(
      source.DEMO_RISK_MULT_A_PLUS_MAJOR,
      DEFAULT_DEMO_OPPORTUNITY_CONFIG.riskMultiplierAPlusMajor
    ),
    riskMultiplierAMajor: parseRiskMult(
      source.DEMO_RISK_MULT_A_MAJOR,
      DEFAULT_DEMO_OPPORTUNITY_CONFIG.riskMultiplierAMajor
    ),
    riskMultiplierAsia: parseRiskMult(
      source.DEMO_RISK_MULT_ASIA,
      DEFAULT_DEMO_OPPORTUNITY_CONFIG.riskMultiplierAsia
    )
  };
}

export function armedWindowMs(
  config: DemoOpportunityConfig = DEFAULT_DEMO_OPPORTUNITY_CONFIG
): number {
  return config.armedConfirmationBars5m * 5 * 60 * 1000;
}

export function classifyDemoSetupTier(
  setupScore: number | null | undefined,
  config: DemoOpportunityConfig = DEFAULT_DEMO_OPPORTUNITY_CONFIG
): DemoSetupTier {
  const score =
    typeof setupScore === "number" && Number.isFinite(setupScore)
      ? setupScore
      : null;
  if (score == null) return "BELOW";
  if (score >= config.aPlusMinScore) return "A_PLUS";
  if (score >= config.aMinScore) return "A";
  return "BELOW";
}

/**
 * Resolve tier for execution / activity / journal.
 * Prefer persisted armed candidate tier so configured thresholds cannot drift
 * between arm and submit. ACTIVE_DEMO never substitutes confidence for a
 * missing setupScore — missing score is BELOW unless a persisted tier exists.
 */
export function resolveExecutionSetupTier(args: {
  armedTier?: DemoSetupTier | null;
  setupScore?: number | null;
  /** Ignored in ACTIVE_DEMO — confidence is not a setup-score substitute. */
  confidence?: number | null;
  config: DemoOpportunityConfig;
}): DemoSetupTier {
  if (
    args.armedTier === "A_PLUS" ||
    args.armedTier === "A" ||
    args.armedTier === "BELOW"
  ) {
    return args.armedTier;
  }
  if (args.config.mode === "ACTIVE_DEMO") {
    return classifyDemoSetupTier(args.setupScore ?? null, args.config);
  }
  // STRICT: legacy may fall back to confidence only when setupScore absent.
  return classifyDemoSetupTier(
    args.setupScore ?? args.confidence ?? null,
    args.config
  );
}

/**
 * ACTIVE_DEMO confirmation contract (editable setting cannot disable):
 * - A: directional 5M confirmation ALWAYS mandatory
 * - A+: confirmation ALSO mandatory — but valid
 *   hasFastDirectionalConfirmation may satisfy it immediately via the
 *   separate fastReady path (not by treating confirmationRequired=false)
 * STRICT retains user-setting semantics.
 */
export function confirmationRequiredForTier(args: {
  mode: DemoOpportunityMode;
  tier: DemoSetupTier;
  settingConfirmationRequired: boolean;
}): boolean {
  if (args.mode === "ACTIVE_DEMO" && (args.tier === "A" || args.tier === "A_PLUS")) {
    return true;
  }
  return args.settingConfirmationRequired;
}

/**
 * Meaningful structural support from existing decision reason strings.
 * Does not invent indicators — only recognises known GoldMeta reason tokens.
 * Structural support alone is NOT sufficient for A+ fast confirmation.
 */
export function hasMeaningfulStructuralSupport(
  reasons: string[] | null | undefined
): boolean {
  const joined = (reasons ?? []).map((r) => String(r).toUpperCase()).join(" ");
  if (!joined.trim()) return false;
  const tokens = [
    "TREND",
    "MTF",
    "MULTI_TIMEFRAME",
    "MARKET_STRUCTURE",
    "STRUCTURE",
    "POC",
    "VAH",
    "VAL",
    "BREAKOUT",
    "RETEST",
    "CONTINUATION",
    "REJECTION",
    "DIRECTIONAL",
    "BULLISH",
    "BEARISH",
    "IMPULSE",
    "ORDER_BLOCK",
    "FVG",
    "LIQUIDITY"
  ];
  return tokens.some((t) => joined.includes(t));
}

/** Explicit opposite confirmation classifications — hard veto for A+ fast path. */
export function isExplicitOppositeConfirmation(args: {
  direction: "BUY" | "SELL";
  confirmationClassification?: string | null;
}): boolean {
  const cls = String(args.confirmationClassification ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (!cls || cls === "NONE") return false;
  if (args.direction === "BUY") {
    return (
      cls.includes("BEARISH") ||
      cls === "REJECTION_CONFIRMED" ||
      (cls.includes("REJECTION") && !cls.includes("BULLISH"))
    );
  }
  return (
    cls.includes("BULLISH") ||
    cls === "BREAKOUT_CONFIRMED" ||
    cls === "BREAKOUT_HELD" ||
    (cls.includes("BREAKOUT") &&
      !cls.includes("BEARISH") &&
      (cls.includes("CONFIRMED") || cls.includes("HELD")))
  );
}

/**
 * Direction-aware A+ fast-confirmation evidence from a COMPLETED decision.
 * Requires existing GoldMeta diagnostics that actually support the trade side.
 * Generic structural tokens (e.g. TREND alone) are insufficient.
 *
 * Priority: EXPLICIT OPPOSITE CONFIRMATION → always false (no reason override).
 * Bare ambiguous "CONFIRMED" alone is never sufficient without side proof.
 */
export function hasFastDirectionalConfirmation(args: {
  direction: "BUY" | "SELL";
  reasons?: string[] | null;
  confirmationClassification?: string | null;
}): boolean {
  const dir = args.direction;
  const cls = String(args.confirmationClassification ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  const joined = (args.reasons ?? [])
    .map((r) => String(r).toUpperCase())
    .join(" ");

  // Hard veto — same-side reason tokens must NEVER override opposite class.
  if (
    isExplicitOppositeConfirmation({
      direction: dir,
      confirmationClassification: cls
    })
  ) {
    return false;
  }

  // Bare "CONFIRMED" is ambiguous — require another side-proving diagnostic.
  const bareConfirmed = cls === "CONFIRMED";

  if (dir === "BUY") {
    const buyClass =
      (!bareConfirmed &&
        (ACCEPTED_BUY_CONFIRMATIONS as readonly string[]).includes(cls)) ||
      (cls.includes("BULLISH") &&
        (cls.includes("BREAKOUT") ||
          cls.includes("REJECTION") ||
          cls.includes("CONTINUATION") ||
          cls.includes("CONFIRMED") ||
          cls.includes("HELD"))) ||
      cls === "BREAKOUT_CONFIRMED" ||
      cls === "BREAKOUT_HELD" ||
      cls === "BREAKOUT_RETEST";
    const buyReasons =
      /\b(BULLISH|BUY_CONFIRM|MTF_BULLISH|BULLISH_CONTINUATION|BULLISH_REJECTION|BREAKOUT_HELD|DIRECTIONAL_BULLISH)\b/.test(
        joined
      ) ||
      (joined.includes("BREAKOUT") &&
        joined.includes("RETEST") &&
        !joined.includes("BEARISH"));
    if (bareConfirmed) return Boolean(buyReasons);
    return Boolean(buyClass || buyReasons);
  }

  const sellClass =
    (!bareConfirmed &&
      (ACCEPTED_SELL_CONFIRMATIONS as readonly string[]).includes(cls)) ||
    (cls.includes("BEARISH") &&
      (cls.includes("BREAKOUT") ||
        cls.includes("REJECTION") ||
        cls.includes("CONTINUATION") ||
        cls.includes("CONFIRMED") ||
        cls.includes("HELD"))) ||
    cls === "REJECTION_CONFIRMED";
  const sellReasons =
    /\b(BEARISH|SELL_CONFIRM|MTF_BEARISH|BEARISH_CONTINUATION|BEARISH_REJECTION|DIRECTIONAL_BEARISH)\b/.test(
      joined
    );
  if (bareConfirmed) return Boolean(sellReasons);
  return Boolean(sellClass || sellReasons);
}

export type MajorSession = "Asia" | "London" | "NewYork" | "Overlap";

export function resolveTradingSessionBucket(now = new Date()): MajorSession {
  const h = now.getUTCHours();
  // Overlap approximate UTC 12–16
  if (h >= 12 && h < 16) return "Overlap";
  return currentSessionUtc(now);
}

export function isAsiaSession(now = new Date()): boolean {
  return resolveTradingSessionBucket(now) === "Asia";
}

/**
 * ACTIVE_DEMO session policy: London/NY/Overlap normal; Asia experimental.
 * STRICT keeps caller-provided allowedSessions behaviour (external).
 */
export function demoSessionPolicyAllows(args: {
  mode: DemoOpportunityMode;
  allowedSessions: string[] | null | undefined;
  tier: DemoSetupTier;
  now?: Date;
  config?: DemoOpportunityConfig;
}): {
  ok: boolean;
  current: MajorSession;
  reason: string | null;
  asiaExperimental: boolean;
} {
  const config = args.config ?? DEFAULT_DEMO_OPPORTUNITY_CONFIG;
  const now = args.now ?? new Date();
  const current = resolveTradingSessionBucket(now);
  const asiaSession = current === "Asia";

  if (args.mode === "STRICT") {
    // Defer to classic sessionAllowed — this helper only annotates.
    return {
      ok: true,
      current,
      reason: null,
      asiaExperimental: false
    };
  }

  if (asiaSession) {
    if (!config.asiaExperimentalEnabled) {
      return {
        ok: false,
        current,
        reason: "SESSION_BLOCKED",
        asiaExperimental: false
      };
    }
    if (args.tier === "BELOW") {
      return {
        ok: false,
        current,
        reason: "TIER_BELOW_A",
        asiaExperimental: true
      };
    }
    return { ok: true, current, reason: null, asiaExperimental: true };
  }

  // Major sessions: tier BELOW is not tradable in ACTIVE_DEMO.
  if (args.tier === "BELOW") {
    return {
      ok: false,
      current,
      reason: "TIER_BELOW_A",
      asiaExperimental: false
    };
  }
  return { ok: true, current, reason: null, asiaExperimental: false };
}

/**
 * Risk multiplier for position sizing only — never alters SL.
 * BELOW / unknown → 0 (fail closed for ACTIVE_DEMO callers).
 */
export function demoRiskMultiplier(args: {
  tier: DemoSetupTier;
  session: string;
  config?: DemoOpportunityConfig;
}): number {
  const config = args.config ?? DEFAULT_DEMO_OPPORTUNITY_CONFIG;
  const session = String(args.session);
  const asia = /^asia$/i.test(session);
  if (args.tier === "BELOW") return 0;
  if (asia) return config.riskMultiplierAsia;
  if (args.tier === "A_PLUS") return config.riskMultiplierAPlusMajor;
  if (args.tier === "A") return config.riskMultiplierAMajor;
  return 0;
}

/** Valid experimental multiplier: finite, >0, <=1. */
export function isValidDemoRiskMultiplier(mult: number): boolean {
  return Number.isFinite(mult) && mult > 0 && mult <= 1;
}

export function applyRiskMultiplier(
  baseRisk: number,
  multiplier: number
): number {
  if (!(baseRisk > 0) || !isValidDemoRiskMultiplier(multiplier)) return 0;
  return Math.round(baseRisk * multiplier * 100) / 100;
}

/**
 * Soft plan-refresh only. NO_TRADE is intentionally excluded — GoldMeta treats
 * NO_TRADE as hard/non-actionable (mismatch / chart-role).
 */
export function isPlanRefreshUnavailableState(
  lifecycleState: string | null | undefined
): boolean {
  return String(lifecycleState ?? "").toUpperCase() === "NO_VALID_PLAN";
}

/**
 * Hard structural invalidators from the session plan.
 * NO_TRADE is hard (non-actionable). Opposite direction handled separately.
 */
export function isHardSessionPlanInvalidator(
  lifecycleState: string | null | undefined
): boolean {
  const s = String(lifecycleState ?? "").toUpperCase();
  return s === "INVALIDATED" || s === "EXPIRED" || s === "NO_TRADE";
}

/**
 * Broker-side mark for stop/invalidation breach checks.
 * BUY (long): use bid — stop is hit when the market trades/bids through SL.
 * SELL (short): use ask — stop is hit when the offer trades through SL.
 * Midpoint is avoided because it can delay recognising a real breach.
 */
export function markPriceForInvalidation(args: {
  direction: "BUY" | "SELL";
  bid: number | null | undefined;
  ask: number | null | undefined;
}): number | null {
  if (args.direction === "BUY") {
    return typeof args.bid === "number" && Number.isFinite(args.bid)
      ? args.bid
      : null;
  }
  return typeof args.ask === "number" && Number.isFinite(args.ask)
    ? args.ask
    : null;
}

/**
 * Accepted confirmation classifications for FAST (A+) and standard (A) paths.
 * Documented for audits — mirrors resolveAuthoritativeConfirmation semantics.
 */
/** Side-proving BUY classifications for A+ fast path (no bare CONFIRMED). */
export const ACCEPTED_BUY_CONFIRMATIONS = [
  "BULLISH_BREAKOUT",
  "BREAKOUT_CONFIRMED",
  "BREAKOUT_HELD",
  "BULLISH_REJECTION",
  "BULLISH_CONTINUATION",
  "BULLISH_CONFIRMED",
  "HELD_BULLISH"
] as const;

/** Side-proving SELL classifications for A+ fast path (no bare CONFIRMED). */
export const ACCEPTED_SELL_CONFIRMATIONS = [
  "BEARISH_REJECTION",
  "REJECTION_CONFIRMED",
  "BEARISH_BREAKOUT",
  "BEARISH_CONTINUATION",
  "BEARISH_CONFIRMED",
  "HELD_BEARISH"
] as const;

export function barsRemainingInArmedWindow(args: {
  armedAt: string;
  nowIso: string;
  bars5m?: number;
}): number {
  const bars =
    args.bars5m ?? DEFAULT_DEMO_OPPORTUNITY_CONFIG.armedConfirmationBars5m;
  const armedMs = Date.parse(args.armedAt);
  const nowMs = Date.parse(args.nowIso);
  if (!Number.isFinite(armedMs) || !Number.isFinite(nowMs)) return 0;
  const elapsed = Math.max(0, nowMs - armedMs);
  const barMs = 5 * 60 * 1000;
  const used = Math.floor(elapsed / barMs);
  return Math.max(0, bars - used);
}

export function formatOpportunityActivity(args: {
  tier: DemoSetupTier;
  direction: string;
  score: number | null;
  event:
    | "FAST_CONFIRMATION_SUBMITTED"
    | "ARMED_WAITING"
    | "CONFIRMED_SUBMITTED"
    | "CANCELLED_INVALIDATED"
    | "EXPIRED"
    | "PLAN_REFRESH_UNAVAILABLE";
  barsRemaining?: number;
  invalidationDetail?: string | null;
}): string {
  const dir = String(args.direction).toUpperCase();
  const score =
    args.score != null && Number.isFinite(args.score)
      ? `${Math.round(args.score)}/100`
      : null;
  const tierLabel =
    args.tier === "A_PLUS" ? "A+" : args.tier === "A" ? "A" : "SETUP";
  const head = score ? `${tierLabel} ${dir} ${score}` : `${tierLabel} ${dir}`;
  switch (args.event) {
    case "FAST_CONFIRMATION_SUBMITTED":
      return `${head} — FAST CONFIRMATION — ORDER SUBMITTED`;
    case "CONFIRMED_SUBMITTED":
      return `${head} — CONFIRMED — ORDER SUBMITTED`;
    case "ARMED_WAITING":
      return `${head} — ARMED — waiting 5M confirmation${
        args.barsRemaining != null
          ? ` — ${args.barsRemaining} bars remaining`
          : ""
      }`;
    case "CANCELLED_INVALIDATED":
      return `${head} — CANCELLED — ${
        args.invalidationDetail || "setup invalidated"
      }`;
    case "EXPIRED":
      return `${head} — EXPIRED — no confirmation within armed window`;
    case "PLAN_REFRESH_UNAVAILABLE":
      return `${head} — PLAN REFRESH UNAVAILABLE — still monitoring candidate`;
    default:
      return head;
  }
}

export type { SessionName };
