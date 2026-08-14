/**
 * FAST_AUTOTRADE_V1 lifecycle — prevents stuck pending states and signal flap.
 */

import type { FastAutoTradeConfig } from "./config";
import { DEFAULT_FAST_AUTOTRADE_CONFIG } from "./config";
import type { FastAction, FastLifecycleContext, FastLifecycleState } from "./types";

const PENDING_STATES: readonly FastLifecycleState[] = [
  "SETUP_FOUND",
  "TRIGGER_PENDING",
  "ENTRY_PENDING"
];

export function timeoutMsForState(
  state: FastLifecycleState,
  config: FastAutoTradeConfig = DEFAULT_FAST_AUTOTRADE_CONFIG
): number | null {
  if (state === "SETUP_FOUND") return config.pendingSetupTimeoutMs;
  if (state === "TRIGGER_PENDING") return config.pendingTriggerTimeoutMs;
  if (state === "ENTRY_PENDING") return config.pendingEntryTimeoutMs;
  return null;
}

export function isPendingStateStuck(
  lifecycle: FastLifecycleContext,
  nowMs: number,
  config: FastAutoTradeConfig = DEFAULT_FAST_AUTOTRADE_CONFIG
): boolean {
  if (!PENDING_STATES.includes(lifecycle.state)) return false;
  const limit = timeoutMsForState(lifecycle.state, config);
  if (limit == null) return false;
  return nowMs - lifecycle.stateEnteredAtMs >= limit;
}

export function nextLifecycleState(args: {
  current: FastLifecycleContext;
  nowMs: number;
  hasSetup: boolean;
  hasTrigger: boolean;
  readyToEnter: boolean;
  isOpen: boolean;
  exiting: boolean;
  closed: boolean;
  config?: FastAutoTradeConfig;
}): FastLifecycleContext {
  const config = args.config ?? DEFAULT_FAST_AUTOTRADE_CONFIG;
  if (args.closed) {
    return { state: "RESET", stateEnteredAtMs: args.nowMs };
  }
  if (isPendingStateStuck(args.current, args.nowMs, config)) {
    return { state: "SCANNING", stateEnteredAtMs: args.nowMs };
  }
  let next: FastLifecycleState = args.current.state;
  if (args.exiting) next = "EXIT_PENDING";
  else if (args.isOpen) next = "MANAGING";
  else if (args.readyToEnter) next = "ENTRY_PENDING";
  else if (args.hasSetup && args.hasTrigger) next = "TRIGGER_PENDING";
  else if (args.hasSetup) next = "SETUP_FOUND";
  else next = "SCANNING";

  if (next === args.current.state) return args.current;
  return { state: next, stateEnteredAtMs: args.nowMs };
}

export function shouldBlockFlap(args: {
  lastAction: FastAction | null;
  lastActionAtMs: number | null;
  nextAction: FastAction;
  nowMs: number;
  flapGuardMs?: number;
}): boolean {
  if (args.nextAction === "WAIT" || args.lastAction == null) return false;
  if (args.lastAction === "WAIT") return false;
  if (args.lastAction === args.nextAction) return false;
  if (args.lastActionAtMs == null) return false;
  const window = args.flapGuardMs ?? DEFAULT_FAST_AUTOTRADE_CONFIG.flapGuardMs;
  return args.nowMs - args.lastActionAtMs < window;
}

export function setupIdentityKey(identity: {
  direction: string;
  setupType: string;
  structureAnchor: string;
}): string {
  return `${identity.direction}:${identity.setupType}:${identity.structureAnchor}`;
}
