/**
 * GOLD HUNTER order gates + DEMO_ONLY / Live refusal.
 * Independent of Core Fast AutoTrade qualification state.
 */

import { isCTraderLiveEnabled } from "../broker/ctrader/flags";
import type { GoldHunterAdminConfig, GoldHunterOrderGateResult, GoldHunterWaitReason } from "./types";
import { GH_ADMIN_EXECUTION_MODE } from "./types";

export type GoldHunterGateInput = {
  config: GoldHunterAdminConfig;
  /** Broker account environment string from connection. */
  brokerEnvironment: string | null;
  brokerConnected: boolean;
  marketOpen: boolean;
  feedFresh: boolean;
  depthValid: boolean;
  spreadOk: boolean;
  capitalOk: boolean;
  dailyLossOk: boolean;
  openTradeCount: number;
  signalPresent: boolean;
  signalConsumed: boolean;
  isAdmin: boolean;
};

/**
 * Absolute Live refuse — no override, no admin bypass.
 */
export function assertGoldHunterDemoOnlyEnvironment(
  brokerEnvironment: string | null
): void {
  if (isCTraderLiveEnabled()) {
    throw Object.assign(new Error("GOLD_HUNTER_LIVE_EXECUTION_DISABLED"), {
      code: "live_execution_enabled_false",
      executionMode: GH_ADMIN_EXECUTION_MODE,
      liveExecutionEnabled: false
    });
  }
  const env = (brokerEnvironment ?? "").trim().toUpperCase();
  if (env === "LIVE" || env === "REAL") {
    throw Object.assign(new Error("GOLD_HUNTER_LIVE_ACCOUNT_REFUSED"), {
      code: "live_account_refused",
      executionMode: GH_ADMIN_EXECUTION_MODE,
      liveExecutionEnabled: false
    });
  }
  if (env && env !== "DEMO") {
    throw Object.assign(new Error("GOLD_HUNTER_NON_DEMO_REFUSED"), {
      code: "non_demo_environment_refused",
      executionMode: GH_ADMIN_EXECUTION_MODE,
      liveExecutionEnabled: false
    });
  }
}

export function evaluateGoldHunterOrderGates(
  input: GoldHunterGateInput
): GoldHunterOrderGateResult {
  const blockers: GoldHunterWaitReason[] = [];

  if (!input.isAdmin) blockers.push("WAIT — UNAUTHORIZED");

  if (isCTraderLiveEnabled()) {
    blockers.push("WAIT — LIVE ENVIRONMENT REFUSED");
  }
  const env = (input.brokerEnvironment ?? "").trim().toUpperCase();
  if (env === "LIVE" || env === "REAL" || (env && env !== "DEMO")) {
    blockers.push("WAIT — LIVE ENVIRONMENT REFUSED");
  }

  if (!input.brokerConnected) blockers.push("WAIT — BROKER DISCONNECTED");
  if (input.config.emergencyStopActive) blockers.push("WAIT — EMERGENCY STOP");
  if (input.config.pauseNewEntries) blockers.push("WAIT — PAUSED");
  if (!input.config.demoAutoTradeEnabled) blockers.push("WAIT — AUTOTRADE OFF");
  if (!input.marketOpen) blockers.push("WAIT — MARKET CLOSED");
  if (!input.feedFresh) blockers.push("WAIT — FEED STALE");
  if (!input.depthValid) blockers.push("WAIT — DEPTH INVALID");
  if (!input.spreadOk) blockers.push("WAIT — SPREAD TOO WIDE");
  if (!input.capitalOk) blockers.push("WAIT — CAPITAL LIMIT");
  if (!input.dailyLossOk) blockers.push("WAIT — DAILY LOSS LIMIT");
  if (input.openTradeCount >= input.config.maxOpenTrades) {
    blockers.push("WAIT — MAX OPEN TRADES");
  }
  if (!input.signalPresent) blockers.push("WAIT — NO SETUP SELECTED");
  if (input.signalConsumed) blockers.push("WAIT — DUPLICATE SIGNAL");

  if (
    !Number.isFinite(input.config.allocatedCapitalEur) ||
    input.config.allocatedCapitalEur <= 0
  ) {
    blockers.push("WAIT — CONFIG INVALID");
  }

  return {
    ok: blockers.length === 0,
    blockers: [...new Set(blockers)],
    executionMode: GH_ADMIN_EXECUTION_MODE,
    liveExecutionEnabled: false
  };
}
