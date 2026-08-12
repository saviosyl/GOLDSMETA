/**
 * ACTIVE_DEMO opportunity engine — Pepperstone Demo only.
 *
 * Separates setup thesis from session-plan refresh, defines A+/A tiers,
 * short armed confirmation window, Asia experimental risk, and risk multipliers.
 *
 * Setup score is NOT win probability.
 * Live execution remains impossible via existing hard locks.
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

export function loadDemoOpportunityConfig(
  source: NodeJS.ProcessEnv = process.env
): DemoOpportunityConfig {
  const modeRaw = String(source.DEMO_OPPORTUNITY_MODE ?? "ACTIVE_DEMO")
    .trim()
    .toUpperCase();
  const mode: DemoOpportunityMode =
    modeRaw === "STRICT" ? "STRICT" : "ACTIVE_DEMO";
  const bars = Number(source.DEMO_ARMED_CONFIRMATION_BARS_5M ?? 3);
  return {
    ...DEFAULT_DEMO_OPPORTUNITY_CONFIG,
    mode,
    armedConfirmationBars5m:
      Number.isFinite(bars) && bars >= 1 && bars <= 12 ? Math.floor(bars) : 3
  };
}

export function armedWindowMs(config: DemoOpportunityConfig = DEFAULT_DEMO_OPPORTUNITY_CONFIG): number {
  return config.armedConfirmationBars5m * 5 * 60 * 1000;
}

export function classifyDemoSetupTier(
  setupScore: number | null | undefined,
  config: DemoOpportunityConfig = DEFAULT_DEMO_OPPORTUNITY_CONFIG
): DemoSetupTier {
  const score = typeof setupScore === "number" && Number.isFinite(setupScore) ? setupScore : null;
  if (score == null) return "BELOW";
  if (score >= config.aPlusMinScore) return "A_PLUS";
  if (score >= config.aMinScore) return "A";
  return "BELOW";
}

/**
 * Meaningful structural support from existing decision reason strings.
 * Does not invent indicators — only recognises known GoldMeta reason tokens.
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

export type MajorSession = "Asia" | "London" | "NewYork" | "Overlap";

export function resolveTradingSessionBucket(now = new Date()): MajorSession {
  const h = now.getUTCHours();
  // Overlap approximate UTC 12–16
  if (h >= 12 && h < 16) return "Overlap";
  const s = currentSessionUtc(now);
  return s;
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
  const asiaExperimental = current === "Asia" && config.asiaExperimentalEnabled;

  if (args.mode === "STRICT") {
    // Defer to classic sessionAllowed — this helper only annotates.
    return { ok: true, current, reason: null, asiaExperimental: false };
  }

  if (current === "Asia") {
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
        reason: "SESSION_BLOCKED",
        asiaExperimental: true
      };
    }
    return { ok: true, current, reason: null, asiaExperimental: true };
  }

  // Major sessions always allowed in ACTIVE_DEMO when tier is tradable.
  if (args.tier === "BELOW") {
    return { ok: false, current, reason: "TIER_BELOW_A", asiaExperimental: false };
  }
  return { ok: true, current, reason: null, asiaExperimental: false };
}

/**
 * Risk multiplier for position sizing only — never alters SL.
 */
export function demoRiskMultiplier(args: {
  tier: DemoSetupTier;
  session: MajorSession | string;
  config?: DemoOpportunityConfig;
}): number {
  const config = args.config ?? DEFAULT_DEMO_OPPORTUNITY_CONFIG;
  const session = String(args.session);
  const asia = /^asia$/i.test(session);
  if (asia) return config.riskMultiplierAsia;
  if (args.tier === "A_PLUS") return config.riskMultiplierAPlusMajor;
  if (args.tier === "A") return config.riskMultiplierAMajor;
  return 0;
}

export function applyRiskMultiplier(
  baseRisk: number,
  multiplier: number
): number {
  if (!(baseRisk > 0) || !(multiplier > 0)) return 0;
  return Math.round(baseRisk * multiplier * 100) / 100;
}

/**
 * Session-plan lifecycle states that REFRESH the external plan but must NOT
 * alone invalidate an already-armed setup thesis.
 */
export function isPlanRefreshUnavailableState(
  lifecycleState: string | null | undefined
): boolean {
  const s = String(lifecycleState ?? "").toUpperCase();
  return s === "NO_VALID_PLAN" || s === "NO_TRADE";
}

/**
 * Hard structural invalidators from the session plan (real thesis breakers).
 * Opposite direction on a still-valid plan is handled separately.
 */
export function isHardSessionPlanInvalidator(
  lifecycleState: string | null | undefined
): boolean {
  const s = String(lifecycleState ?? "").toUpperCase();
  return s === "INVALIDATED" || s === "EXPIRED";
}

/**
 * Accepted confirmation classifications for FAST (A+) and standard (A) paths.
 * Documented for audits — mirrors resolveAuthoritativeConfirmation semantics.
 */
export const ACCEPTED_BUY_CONFIRMATIONS = [
  "BULLISH_BREAKOUT",
  "BREAKOUT_CONFIRMED",
  "BREAKOUT_HELD",
  "BULLISH_REJECTION",
  "BULLISH_CONTINUATION",
  "BULLISH_CONFIRMED",
  "HELD_BULLISH",
  "CONFIRMED"
] as const;

export const ACCEPTED_SELL_CONFIRMATIONS = [
  "BEARISH_REJECTION",
  "REJECTION_CONFIRMED",
  "BEARISH_BREAKOUT",
  "BEARISH_CONTINUATION",
  "BEARISH_CONFIRMED",
  "HELD_BEARISH",
  "CONFIRMED"
] as const;

export function barsRemainingInArmedWindow(args: {
  armedAt: string;
  nowIso: string;
  bars5m?: number;
}): number {
  const bars = args.bars5m ?? DEFAULT_DEMO_OPPORTUNITY_CONFIG.armedConfirmationBars5m;
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
  const tierLabel = args.tier === "A_PLUS" ? "A+" : args.tier === "A" ? "A" : "SETUP";
  const head = score ? `${tierLabel} ${dir} ${score}` : `${tierLabel} ${dir}`;
  switch (args.event) {
    case "FAST_CONFIRMATION_SUBMITTED":
      return `${head} — FAST CONFIRMATION — ORDER SUBMITTED`;
    case "CONFIRMED_SUBMITTED":
      return `${head} — CONFIRMED — ORDER SUBMITTED`;
    case "ARMED_WAITING":
      return `${head} — ARMED — waiting 5M confirmation${
        args.barsRemaining != null ? ` — ${args.barsRemaining} bars remaining` : ""
      }`;
    case "CANCELLED_INVALIDATED":
      return `${head} — CANCELLED — ${args.invalidationDetail || "setup invalidated"}`;
    case "EXPIRED":
      return `${head} — EXPIRED — no confirmation within armed window`;
    case "PLAN_REFRESH_UNAVAILABLE":
      return `${head} — PLAN REFRESH UNAVAILABLE — still monitoring candidate`;
    default:
      return head;
  }
}

export type { SessionName };
