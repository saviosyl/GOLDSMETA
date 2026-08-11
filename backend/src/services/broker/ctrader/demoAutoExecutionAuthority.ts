/**
 * Single authority helper for Pepperstone Demo Auto execution permission.
 *
 * Legacy autoTradeRiskState.mode (OFF/SHADOW/…) must not silently disagree with
 * qualification + autotradeSettings/demo for whether Demo orders may submit.
 *
 * This module is THE authoritative source for Demo Auto ON/OFF labels across
 * API + UI. Live execution remains hard-locked elsewhere.
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
  executionEligible: boolean;
  /** Distinct from legacy risk.mode — never overridden by IG/T212 OFF. */
  authorityLabel: DemoAutoExecutionAuthority["authorityLabel"];
  startedAt: string | null;
  demoAutoEnabledAt: string | null;
  quoteAgeSeconds: number | null;
  quoteExecutable: boolean | null;
  marketStatus: string | null;
};

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
  if (!state || !allowsDemoOrderSubmission(state)) {
    reasons.push("QUALIFICATION_STATE_BLOCKS_ORDERS");
  }

  const demoExecutionEnabled =
    !input.selectedAccountIsLive &&
    !input.emergencyStopActive &&
    !input.autoTradePaused &&
    input.autoTradeEnabledIntent &&
    input.demoOrderSubmissionEnabled &&
    Boolean(state && allowsDemoOrderSubmission(state));

  let authorityLabel: DemoAutoExecutionAuthority["authorityLabel"] = "OFF";
  if (input.selectedAccountIsLive) authorityLabel = "DEMO_AUTO_LOCKED_LIVE";
  else if (demoExecutionEnabled) authorityLabel = "DEMO_AUTO";
  else if (
    input.autoTradeEnabledIntent &&
    state &&
    allowsDemoOrderSubmission(state) &&
    input.autoTradePaused
  ) {
    authorityLabel = "DEMO_AUTO_PAUSED";
  }

  return { demoExecutionEnabled, authorityLabel, reasons };
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

  const executionEligible =
    authority.demoExecutionEnabled &&
    args.quoteHealthy &&
    args.tradingScope === "trading" &&
    Boolean(args.selectedDemoAccount);

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
    executionEligible,
    authorityLabel: authority.authorityLabel,
    startedAt: args.startedAt ?? null,
    demoAutoEnabledAt: args.demoAutoEnabledAt ?? null,
    quoteAgeSeconds: args.quoteAgeSeconds ?? null,
    quoteExecutable: args.quoteExecutable ?? null,
    marketStatus: args.marketStatus ?? null
  };
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
 */
export function demoAutoSurfaceLabels(authority: DemoAutoAuthorityApi | DemoAutoExecutionAuthority): {
  autoTrade: "ON" | "OFF" | "PAUSED" | "LOCKED";
  orderSubmissionEnabled: boolean;
} {
  const enabled =
    "enabled" in authority ? authority.enabled : authority.demoExecutionEnabled;
  const label =
    "label" in authority
      ? authority.label
      : authority.authorityLabel === "DEMO_AUTO"
        ? "ON"
        : authority.authorityLabel === "DEMO_AUTO_PAUSED"
          ? "PAUSED"
          : authority.authorityLabel === "DEMO_AUTO_LOCKED_LIVE"
            ? "LOCKED_LIVE"
            : "OFF";

  if (label === "LOCKED_LIVE") {
    return { autoTrade: "LOCKED", orderSubmissionEnabled: false };
  }
  if (label === "PAUSED") {
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
