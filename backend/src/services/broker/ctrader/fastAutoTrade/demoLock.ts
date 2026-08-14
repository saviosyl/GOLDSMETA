/**
 * Server-side Demo-only lock for FAST_AUTOTRADE_V1.
 * Independent of UI, localStorage, and client account selection.
 * Manual trading must not use this helper.
 */

import { FAST_AUTOTRADE_STRATEGY_ID } from "./types";

export const FAST_AUTOTRADE_V1_DEMO_ONLY = "FAST_AUTOTRADE_V1_DEMO_ONLY" as const;

export class FastAutoTradeLiveBlockedError extends Error {
  readonly code = FAST_AUTOTRADE_V1_DEMO_ONLY;
  constructor() {
    super(FAST_AUTOTRADE_V1_DEMO_ONLY);
    this.name = "FastAutoTradeLiveBlockedError";
  }
}

export function isDemoAccountForFastStrategy(args: {
  accountIsLive?: boolean | null;
  environment?: string | null;
}): boolean {
  if (args.accountIsLive === true) return false;
  const env = String(args.environment ?? "").trim().toUpperCase();
  if (env === "LIVE") return false;
  if (env === "DEMO") return true;
  return args.accountIsLive === false;
}

/**
 * FAST_AUTOTRADE_V1 may place automated orders only on Demo.
 * Returns ok=false with FAST_AUTOTRADE_V1_DEMO_ONLY when Live.
 */
export function evaluateFastAutoTradeDemoLock(args: {
  strategyId?: string | null;
  accountIsLive?: boolean | null;
  environment?: string | null;
}): { ok: boolean; reason: typeof FAST_AUTOTRADE_V1_DEMO_ONLY | null } {
  const strategy = String(args.strategyId ?? "").trim();
  if (strategy !== FAST_AUTOTRADE_STRATEGY_ID) {
    return { ok: true, reason: null };
  }
  if (isDemoAccountForFastStrategy(args)) {
    return { ok: true, reason: null };
  }
  return { ok: false, reason: FAST_AUTOTRADE_V1_DEMO_ONLY };
}

export function assertFastAutoTradeDemoOnly(args: {
  strategyId?: string | null;
  accountIsLive?: boolean | null;
  environment?: string | null;
}): void {
  const gate = evaluateFastAutoTradeDemoLock(args);
  if (!gate.ok) {
    throw new FastAutoTradeLiveBlockedError();
  }
}
