/**
 * Single authority helper for Pepperstone Demo Auto execution permission.
 *
 * Legacy autoTradeRiskState.mode (OFF/SHADOW/…) must not silently disagree with
 * qualification + autotradeSettings/demo for whether Demo orders may submit.
 *
 * This module is THE authoritative source for Demo Auto ON/OFF labels across
 * API + UI AND the broker submission boundary. Live execution remains hard-locked.
 *
 * Three concepts (keep separate):
 * A) Demo Auto ENABLED — owner intent + qual state allow autonomous Demo trading
 * B) Submission AUTHORIZED — enabled + Demo selected + trading OAuth + runtime flag
 * C) Execution ELIGIBLE NOW — authorized AND market/quote healthy right now
 *
 * CONTROLLED_DEMO_QUALIFICATION is a separate permission path for the
 * qualification ladder BEFORE Demo Auto intent is required. It must not bypass
 * the owner's Demo Auto OFF switch once state is DEMO_AUTO_ENABLED / LIVE_QUALIFICATION.
 */

import { getConnection } from "./connectionStore";
import { isCTraderDemoOrderSubmissionEnabled } from "./flags";
import {
  allowsDemoOrderSubmission,
  deriveAdvancedState
} from "./qualificationMachine";
import { getActiveQualificationAccountId, getQualificationDoc } from "./qualificationStore";
import type { QualificationState } from "./qualificationTypes";
import { getUserAutoTradeSettings } from "./userAutoTradeSettings";
import { getStoredAuthoritativeQuote } from "./quoteStore";

export type DemoAutoExecutionAuthorityInput = {
  qualificationState: QualificationState | null | undefined;
  autoTradeEnabledIntent: boolean;
  autoTradePaused: boolean;
  emergencyStopActive: boolean;
  selectedAccountIsLive: boolean;
  /** Runtime Demo submission flag (CTRADER_DEMO_ORDER_SUBMISSION_ENABLED). */
  demoOrderSubmissionEnabled: boolean;
};

export type DemoAutoExecutionAuthority = {
  /** True when the Pepperstone Demo Auto path may submit an order. */
  demoExecutionEnabled: boolean;
  /** Stable label for API/status surfaces (not the legacy risk.mode). */
  authorityLabel: "DEMO_AUTO" | "DEMO_AUTO_PAUSED" | "DEMO_AUTO_LOCKED_LIVE" | "OFF";
  reasons: string[];
};

/**
 * Safe API object — every UI surface must derive Demo Auto status from this.
 * Live execution is never enabled by this object.
 */
export type DemoAutoAuthorityApi = {
  /** A) Owner Demo Auto ENABLED (intent + qual + not paused/e-stop + flag). */
  enabled: boolean;
  label: "ON" | "OFF" | "PAUSED" | "LOCKED_LIVE";
  reasons: string[];
  qualificationState: QualificationState | null;
  intentEnabled: boolean;
  paused: boolean;
  emergencyStop: boolean;
  demoSubmissionFlag: boolean;
  selectedDemoAccount: string | null;
  tradingScope: "accounts" | "trading" | null;
  quoteHealthy: boolean;
  /** B) Submission AUTHORIZED — enabled + Demo selected + trading OAuth. */
  submissionAuthorized: boolean;
  /** C) Execution ELIGIBLE NOW — authorized AND quote/market healthy. */
  executionEligible: boolean;
  /** Human label for C, e.g. READY / WAITING — MARKET CLOSED / BLOCKED. */
  executionNowLabel: string;
  /** Distinct from legacy risk.mode — never overridden by IG/T212 OFF. */
  authorityLabel: DemoAutoExecutionAuthority["authorityLabel"];
  startedAt: string | null;
  demoAutoEnabledAt: string | null;
  quoteAgeSeconds: number | null;
  quoteExecutable: boolean | null;
  marketStatus: string | null;
};

/** Autonomous Demo Auto states that require owner intent=true. */
export const AUTONOMOUS_DEMO_ORDER_STATES: QualificationState[] = [
  "DEMO_AUTO_ENABLED",
  "LIVE_QUALIFICATION"
];

/**
 * Controlled qualification may place Demo orders to prove the ladder
 * BEFORE the owner enables Demo Auto intent. Explicit and separate from
 * autonomous Demo Auto authority.
 */
export function allowsControlledDemoQualificationOrders(
  state: QualificationState | null | undefined
): boolean {
  return state === "CONTROLLED_DEMO_QUALIFICATION";
}

export type ControlledDemoOrderAuthorityInput = {
  qualificationState: QualificationState | null | undefined;
  autoTradePaused: boolean;
  emergencyStopActive: boolean;
  selectedAccountIsLive: boolean;
  demoAccountSelected: boolean;
  tradingScope: "accounts" | "trading" | null;
  demoOrderSubmissionEnabled: boolean;
};

export type ControlledDemoOrderAuthority = {
  allowed: boolean;
  reasons: string[];
};

/**
 * Permission for CONTROLLED_DEMO_QUALIFICATION ladder orders only.
 * Does NOT require autoTradeEnabledIntent — by design.
 * Must never be used for DEMO_AUTO_ENABLED / LIVE_QUALIFICATION.
 */
export function evaluateControlledDemoOrderAuthority(
  input: ControlledDemoOrderAuthorityInput
): ControlledDemoOrderAuthority {
  const reasons: string[] = [];
  if (input.selectedAccountIsLive) reasons.push("SELECTED_ACCOUNT_IS_LIVE");
  if (!input.demoAccountSelected) reasons.push("DEMO_ACCOUNT_NOT_SELECTED");
  if (input.tradingScope !== "trading") reasons.push("TRADING_OAUTH_REQUIRED");
  if (input.emergencyStopActive) reasons.push("EMERGENCY_STOP");
  if (input.autoTradePaused) reasons.push("AUTOTRADE_PAUSED");
  if (!input.demoOrderSubmissionEnabled) reasons.push("DEMO_SUBMISSION_FLAG_OFF");
  if (!allowsControlledDemoQualificationOrders(input.qualificationState)) {
    reasons.push("NOT_CONTROLLED_DEMO_STATE");
  }
  return { allowed: reasons.length === 0, reasons };
}

export function evaluateDemoAutoExecutionAuthority(
  input: DemoAutoExecutionAuthorityInput
): DemoAutoExecutionAuthority {
  const reasons: string[] = [];
  const state = (input.qualificationState ?? null) as QualificationState | null;

  if (input.selectedAccountIsLive) {
    return {
      demoExecutionEnabled: false,
      authorityLabel: "DEMO_AUTO_LOCKED_LIVE",
      reasons: ["SELECTED_ACCOUNT_IS_LIVE"]
    };
  }
  if (input.emergencyStopActive) {
    reasons.push("EMERGENCY_STOP");
  }
  if (input.autoTradePaused) {
    reasons.push("AUTOTRADE_PAUSED");
  }
  if (!input.autoTradeEnabledIntent) {
    reasons.push("INTENT_OFF");
  }
  if (!input.demoOrderSubmissionEnabled) {
    reasons.push("DEMO_SUBMISSION_FLAG_OFF");
  }
  // Autonomous Demo Auto requires DEMO_AUTO_ENABLED / LIVE_QUALIFICATION.
  // CONTROLLED_DEMO is handled by evaluateControlledDemoOrderAuthority instead.
  const autonomousOk =
    state != null && AUTONOMOUS_DEMO_ORDER_STATES.includes(state);
  if (!autonomousOk) {
    // Keep prior allowsDemoOrderSubmission semantics for label surfaces that
    // still treat CONTROLLED as "can eventually submit", but do not enable
    // autonomous authority from CONTROLLED alone.
    if (!state || !allowsDemoOrderSubmission(state)) {
      reasons.push("QUALIFICATION_STATE_BLOCKS_ORDERS");
    } else if (state === "CONTROLLED_DEMO_QUALIFICATION") {
      reasons.push("CONTROLLED_PHASE_REQUIRES_SEPARATE_PERMISSION");
    } else {
      reasons.push("QUALIFICATION_STATE_BLOCKS_ORDERS");
    }
  }

  const demoExecutionEnabled =
    !input.selectedAccountIsLive &&
    !input.emergencyStopActive &&
    !input.autoTradePaused &&
    input.autoTradeEnabledIntent &&
    input.demoOrderSubmissionEnabled &&
    autonomousOk;

  let authorityLabel: DemoAutoExecutionAuthority["authorityLabel"] = "OFF";
  if (input.selectedAccountIsLive) authorityLabel = "DEMO_AUTO_LOCKED_LIVE";
  else if (demoExecutionEnabled) authorityLabel = "DEMO_AUTO";
  else if (
    input.autoTradeEnabledIntent &&
    autonomousOk &&
    input.autoTradePaused
  ) {
    authorityLabel = "DEMO_AUTO_PAUSED";
  }

  return { demoExecutionEnabled, authorityLabel, reasons };
}

export function executionNowLabelFor(args: {
  submissionAuthorized: boolean;
  executionEligible: boolean;
  marketStatus: string | null;
  quoteHealthy: boolean;
  reasons: string[];
}): string {
  if (args.executionEligible) return "READY";
  if (!args.submissionAuthorized) {
    const first = args.reasons[0];
    if (first === "EMERGENCY_STOP") return "BLOCKED — EMERGENCY STOP";
    if (first === "AUTOTRADE_PAUSED") return "BLOCKED — PAUSED";
    if (first === "INTENT_OFF") return "BLOCKED — INTENT OFF";
    if (first === "SELECTED_ACCOUNT_IS_LIVE") return "LOCKED — LIVE";
    return "BLOCKED";
  }
  if (args.marketStatus === "CLOSED") return "WAITING — MARKET CLOSED";
  if (!args.quoteHealthy) return "WAITING — EXECUTION QUOTE STALE";
  return "WAITING";
}

export function toDemoAutoAuthorityApi(args: {
  authority: DemoAutoExecutionAuthority;
  qualificationState: QualificationState | null;
  intentEnabled: boolean;
  paused: boolean;
  emergencyStop: boolean;
  demoSubmissionFlag: boolean;
  selectedDemoAccount: string | null;
  tradingScope: "accounts" | "trading" | null;
  quoteHealthy: boolean;
  quoteAgeSeconds?: number | null;
  quoteExecutable?: boolean | null;
  marketStatus?: string | null;
  startedAt?: string | null;
  demoAutoEnabledAt?: string | null;
}): DemoAutoAuthorityApi {
  const { authority } = args;
  let label: DemoAutoAuthorityApi["label"] = "OFF";
  if (authority.authorityLabel === "DEMO_AUTO_LOCKED_LIVE") label = "LOCKED_LIVE";
  else if (authority.authorityLabel === "DEMO_AUTO_PAUSED") label = "PAUSED";
  else if (authority.demoExecutionEnabled) label = "ON";

  const submissionAuthorized =
    authority.demoExecutionEnabled &&
    args.tradingScope === "trading" &&
    Boolean(args.selectedDemoAccount);

  const executionEligible = submissionAuthorized && args.quoteHealthy;
  const marketStatus = args.marketStatus ?? null;

  return {
    enabled: authority.demoExecutionEnabled,
    label,
    reasons: authority.reasons,
    qualificationState: args.qualificationState,
    intentEnabled: args.intentEnabled,
    paused: args.paused,
    emergencyStop: args.emergencyStop,
    demoSubmissionFlag: args.demoSubmissionFlag,
    selectedDemoAccount: args.selectedDemoAccount,
    tradingScope: args.tradingScope,
    quoteHealthy: args.quoteHealthy,
    submissionAuthorized,
    executionEligible,
    executionNowLabel: executionNowLabelFor({
      submissionAuthorized,
      executionEligible,
      marketStatus,
      quoteHealthy: args.quoteHealthy,
      reasons: authority.reasons
    }),
    authorityLabel: authority.authorityLabel,
    startedAt: args.startedAt ?? null,
    demoAutoEnabledAt: args.demoAutoEnabledAt ?? null,
    quoteAgeSeconds: args.quoteAgeSeconds ?? null,
    quoteExecutable: args.quoteExecutable ?? null,
    marketStatus
  };
}

/**
 * Final broker-submission gate for autonomous Demo Auto
 * (DEMO_AUTO_ENABLED / LIVE_QUALIFICATION).
 * Fail closed unless Demo + trading OAuth + intent + not paused + not e-stop + flag.
 */
export function assertAutonomousDemoSubmissionAllowed(
  authority: DemoAutoAuthorityApi
): { ok: true } | { ok: false; reasonCode: string; reasons: string[] } {
  if (authority.qualificationState === "CONTROLLED_DEMO_QUALIFICATION") {
    return {
      ok: false,
      reasonCode: "EXECUTION_AUTHORITY_OFF",
      reasons: ["USE_CONTROLLED_PERMISSION_PATH"]
    };
  }
  if (!authority.enabled) {
    return {
      ok: false,
      reasonCode: "EXECUTION_AUTHORITY_OFF",
      reasons: authority.reasons.length ? authority.reasons : ["AUTHORITY_OFF"]
    };
  }
  if (authority.tradingScope !== "trading") {
    return {
      ok: false,
      reasonCode: "EXECUTION_AUTHORITY_OFF",
      reasons: ["TRADING_OAUTH_REQUIRED", ...authority.reasons]
    };
  }
  if (!authority.selectedDemoAccount) {
    return {
      ok: false,
      reasonCode: "EXECUTION_AUTHORITY_OFF",
      reasons: ["DEMO_ACCOUNT_NOT_SELECTED", ...authority.reasons]
    };
  }
  if (!authority.demoSubmissionFlag) {
    return {
      ok: false,
      reasonCode: "EXECUTION_AUTHORITY_OFF",
      reasons: ["DEMO_SUBMISSION_FLAG_OFF", ...authority.reasons]
    };
  }
  return { ok: true };
}

/**
 * Resolve Demo Auto authority for a user from Firestore + runtime flags.
 * Never auto-enables from false intent. Never enables Live execution.
 */
export async function resolveDemoAutoAuthorityForUser(
  uid: string
): Promise<DemoAutoAuthorityApi> {
  try {
    const connection = await getConnection(uid);
    const isLive = Boolean(connection?.selectedAccountIsLive);
    const demoSettings = await getUserAutoTradeSettings(uid, "demo");
    const accountId =
      (!isLive ? connection?.selectedAccountId : null) ??
      demoSettings.selectedAccountId ??
      (await getActiveQualificationAccountId(uid).catch(() => null));

    let qualificationState: QualificationState | null = null;
    let startedAt: string | null = null;
    let demoAutoEnabledAt: string | null = null;
    if (accountId && !isLive) {
      const qual = await getQualificationDoc(uid, accountId).catch(() => null);
      if (qual) {
        qualificationState = deriveAdvancedState(qual);
        startedAt = qual.startedAt ?? null;
        demoAutoEnabledAt = qual.demoAutoEnabledAt ?? null;
      }
    }

    const demoSubmissionFlag = isCTraderDemoOrderSubmissionEnabled();
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState,
      autoTradeEnabledIntent: demoSettings.autoTradeEnabledIntent,
      autoTradePaused: demoSettings.autoTradePaused,
      emergencyStopActive: demoSettings.emergencyStopActive,
      selectedAccountIsLive: isLive,
      demoOrderSubmissionEnabled: demoSubmissionFlag
    });

    let quoteHealthy = false;
    let quoteAgeSeconds: number | null = null;
    let quoteExecutable: boolean | null = null;
    let marketStatus: string | null = null;
    try {
      const q = await getStoredAuthoritativeQuote(uid);
      if (q) {
        marketStatus = q.marketStatus ?? null;
        quoteExecutable = q.executable ?? null;
        if (q.brokerTimestamp) {
          quoteAgeSeconds = Math.max(
            0,
            (Date.now() - Date.parse(q.brokerTimestamp)) / 1000
          );
        }
        const open = q.marketStatus === "OPEN" || q.marketStatus === "UNKNOWN";
        quoteHealthy =
          Boolean(q.executable) &&
          open &&
          (quoteAgeSeconds == null ||
            quoteAgeSeconds <= (demoSettings.maxQuoteAgeSeconds || 15));
      }
    } catch {
      quoteHealthy = false;
    }

    const selectedDemoAccount =
      !isLive && (connection?.selectedAccountMasked || demoSettings.selectedAccountId)
        ? connection?.selectedAccountMasked ?? maskAccountId(demoSettings.selectedAccountId)
        : null;

    return toDemoAutoAuthorityApi({
      authority,
      qualificationState,
      intentEnabled: demoSettings.autoTradeEnabledIntent,
      paused: demoSettings.autoTradePaused,
      emergencyStop: demoSettings.emergencyStopActive,
      demoSubmissionFlag,
      selectedDemoAccount,
      tradingScope: connection?.oauthScope ?? null,
      quoteHealthy,
      quoteAgeSeconds,
      quoteExecutable,
      marketStatus,
      startedAt,
      demoAutoEnabledAt
    });
  } catch {
    // Fail closed — never throw into HTTP surfaces; never invent enabled=true.
    const demoSubmissionFlag = isCTraderDemoOrderSubmissionEnabled();
    return toDemoAutoAuthorityApi({
      authority: {
        demoExecutionEnabled: false,
        authorityLabel: "OFF",
        reasons: ["AUTHORITY_RESOLVE_FAILED"]
      },
      qualificationState: null,
      intentEnabled: false,
      paused: false,
      emergencyStop: false,
      demoSubmissionFlag,
      selectedDemoAccount: null,
      tradingScope: null,
      quoteHealthy: false
    });
  }
}

function maskAccountId(id: string | null | undefined): string | null {
  if (!id) return null;
  const s = String(id);
  if (s.length < 4) return "…";
  return `${s.slice(0, 2)}…${s.slice(-2)}`;
}

/**
 * Surface labels for legacy autoTrade / orderSubmissionEnabled fields.
 * Live order submission is ALWAYS false. Demo submission follows authority.
 * orderSubmissionEnabled reflects submissionAuthorized (B), not market-open (C).
 */
export function demoAutoSurfaceLabels(authority: DemoAutoAuthorityApi | DemoAutoExecutionAuthority): {
  autoTrade: "ON" | "OFF" | "PAUSED" | "LOCKED";
  orderSubmissionEnabled: boolean;
} {
  if ("submissionAuthorized" in authority) {
    if (authority.label === "LOCKED_LIVE") {
      return { autoTrade: "LOCKED", orderSubmissionEnabled: false };
    }
    if (authority.label === "PAUSED" || authority.emergencyStop) {
      return {
        autoTrade: authority.emergencyStop ? "OFF" : "PAUSED",
        orderSubmissionEnabled: false
      };
    }
    if (authority.enabled) {
      return {
        autoTrade: "ON",
        orderSubmissionEnabled: authority.submissionAuthorized
      };
    }
    return { autoTrade: "OFF", orderSubmissionEnabled: false };
  }

  const enabled = authority.demoExecutionEnabled;
  if (authority.authorityLabel === "DEMO_AUTO_LOCKED_LIVE") {
    return { autoTrade: "LOCKED", orderSubmissionEnabled: false };
  }
  if (authority.authorityLabel === "DEMO_AUTO_PAUSED") {
    return { autoTrade: "PAUSED", orderSubmissionEnabled: false };
  }
  if (enabled) {
    return { autoTrade: "ON", orderSubmissionEnabled: true };
  }
  return { autoTrade: "OFF", orderSubmissionEnabled: false };
}

/**
 * Detect silent disagreement between legacy risk mode and Demo Auto authority.
 * Used in tests and diagnostics — does not change either store by itself.
 */
export function demoAutoAuthorityConflictsWithLegacyMode(args: {
  legacyMode: string | null | undefined;
  authority: DemoAutoExecutionAuthority | DemoAutoAuthorityApi;
}): boolean {
  const legacy = String(args.legacyMode ?? "OFF").toUpperCase();
  const enabled =
    "enabled" in args.authority
      ? args.authority.enabled
      : args.authority.demoExecutionEnabled;
  if (enabled && legacy === "OFF") return true;
  if (!enabled && (legacy === "DEMO" || legacy === "LIVE")) {
    return true;
  }
  return false;
}
