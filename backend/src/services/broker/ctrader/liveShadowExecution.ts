/**
 * Pepperstone LIVE AutoTrade SHADOW execution layer.
 *
 * Processes genuine GoldMeta BUY/SELL decisions against the selected LIVE
 * account, computes the exact market order that WOULD be submitted, and
 * persists an audit record. Never calls ProtoOANewOrderReq / Live order APIs.
 *
 * isCTraderLiveEnabled() and isCTraderLiveExecutionOwnerApproved() remain
 * hard-false. Do not reorder or repair plan entry/SL/TP values.
 */

import { randomBytes } from "node:crypto";
import type { DecisionRecord } from "../../../models/types";
import type { GoldMetaStore } from "../../storage/types";
import type { BrokerQuote, BrokerSymbol } from "../domain";
import { logger } from "../../logging/logger";
import {
  assertCTraderLiveMutationsDisabled,
  CTRADER_RECOMMENDED_DEFAULTS,
  isCTraderLiveEnabled,
  isCTraderLiveExecutionOwnerApproved,
  isCTraderLiveShadowEnabled
} from "./flags";
import { getConnection } from "./connectionStore";
import {
  assertBrokerUser,
  ensureFreshAccessToken
} from "./connectionService";
import {
  createOpenApiClient,
  type CTraderOpenApiClient,
  type TradingReconcileState
} from "./openApiClient";
import { getStoredAuthoritativeQuote } from "./quoteStore";
import {
  refreshAuthoritativeFreshness,
  toBrokerQuote,
  isQuoteExecutableForAutoTrade,
  executableEntryPrice
} from "./liveQuote";
import { getUserAutoTradeSettings } from "./userAutoTradeSettings";
import { buildTradePreview, buildIntentKey } from "./preview";
import { validateLotsAgainstRules, roundDownLotsToStep } from "./volumeUnits";
import { assertAccountAllowlisted, parseAccountAllowlist } from "./accountAllowlist";
import { maskAccountId } from "./tokenCrypto";
import {
  persistLiveShadowExecution,
  maskAccountForShadow,
  type LiveShadowExecutionRecord,
  type LiveShadowPlanSnapshot,
  type LiveShadowWouldSubmitOrder,
  type CTraderWouldBeOrderPayload,
  type SignalFreshnessClass
} from "./liveShadowStore";

const SPOT_PRICE_SCALE = 100_000;
/** Max adverse move from plan entry to live ask/bid before rejecting (price units). */
const DEFAULT_MAX_SLIPPAGE = 3;

export type LiveShadowProcessResult = {
  skipped: boolean;
  outcome: LiveShadowExecutionRecord["outcome"] | "SHADOW_DISABLED" | "ERROR";
  intentKey: string | null;
  record: LiveShadowExecutionRecord | null;
  message: string;
};

function clientCreds(): { clientId: string; clientSecret: string } {
  return {
    clientId: (process.env.CTRADER_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.CTRADER_CLIENT_SECRET ?? "").trim()
  };
}

function candleConfirmed(decision: DecisionRecord): boolean {
  const c = decision.marketStructure?.confirmationClassification;
  if (c && c !== "NONE") return true;
  return !decision.isProvisional && decision.dataQuality === "GOOD";
}

function tpByLabel(
  takeProfits: DecisionRecord["takeProfits"] | undefined,
  label: "TP1" | "TP2" | "TP3"
): number | null {
  const hit = takeProfits?.find((t) => t.label === label);
  if (hit && Number.isFinite(hit.price)) return hit.price;
  return null;
}

/** Extract originating plan levels — never modified by the execution layer. */
export function extractPlanSnapshot(decision: DecisionRecord): LiveShadowPlanSnapshot {
  return {
    plannedEntry: decision.entry?.price ?? null,
    stopLoss: decision.stopLoss?.price ?? null,
    takeProfit1: tpByLabel(decision.takeProfits, "TP1"),
    takeProfit2: tpByLabel(decision.takeProfits, "TP2"),
    takeProfit3: tpByLabel(decision.takeProfits, "TP3"),
    confidence: decision.confidence ?? null,
    confidenceLabel: decision.confidenceLabel ?? null,
    setupScore: decision.setupScore ?? null,
    generatedAt: decision.generatedAt ?? null
  };
}

/**
 * Validate SL / executable entry / TP ladder against LIVE executable price.
 * Does not repair or reorder plan targets — rejects only.
 */
export function validateStopTpLadder(args: {
  side: "BUY" | "SELL";
  entry: number;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
}): string[] {
  const failed: string[] = [];
  if (args.stopLoss == null || !Number.isFinite(args.stopLoss)) {
    failed.push("STOP_LOSS_REQUIRED");
    return failed;
  }
  if (args.takeProfit1 == null || !Number.isFinite(args.takeProfit1)) {
    failed.push("TAKE_PROFIT_REQUIRED");
    return failed;
  }

  if (args.side === "BUY") {
    if (!(args.stopLoss < args.entry)) failed.push("STOP_ORDERING_INVALID");
    if (!(args.entry < args.takeProfit1)) failed.push("TP_ORDERING_INVALID");
    if (
      args.takeProfit2 != null &&
      Number.isFinite(args.takeProfit2) &&
      !(args.takeProfit1 < args.takeProfit2)
    ) {
      failed.push("TP_ORDERING_INVALID");
    }
    if (
      args.takeProfit3 != null &&
      Number.isFinite(args.takeProfit3) &&
      args.takeProfit2 != null &&
      Number.isFinite(args.takeProfit2) &&
      !(args.takeProfit2 < args.takeProfit3)
    ) {
      failed.push("TP_ORDERING_INVALID");
    }
    if (
      args.takeProfit3 != null &&
      Number.isFinite(args.takeProfit3) &&
      args.takeProfit2 == null &&
      !(args.takeProfit1 < args.takeProfit3)
    ) {
      failed.push("TP_ORDERING_INVALID");
    }
  } else {
    if (!(args.stopLoss > args.entry)) failed.push("STOP_ORDERING_INVALID");
    if (!(args.entry > args.takeProfit1)) failed.push("TP_ORDERING_INVALID");
    if (
      args.takeProfit2 != null &&
      Number.isFinite(args.takeProfit2) &&
      !(args.takeProfit1 > args.takeProfit2)
    ) {
      failed.push("TP_ORDERING_INVALID");
    }
    if (
      args.takeProfit3 != null &&
      Number.isFinite(args.takeProfit3) &&
      args.takeProfit2 != null &&
      Number.isFinite(args.takeProfit2) &&
      !(args.takeProfit2 > args.takeProfit3)
    ) {
      failed.push("TP_ORDERING_INVALID");
    }
    if (
      args.takeProfit3 != null &&
      Number.isFinite(args.takeProfit3) &&
      args.takeProfit2 == null &&
      !(args.takeProfit1 > args.takeProfit3)
    ) {
      failed.push("TP_ORDERING_INVALID");
    }
  }
  return [...new Set(failed)];
}

function relativeProtection(args: {
  side: "BUY" | "SELL";
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
}): { relativeStopLoss: number | null; relativeTakeProfit: number | null } {
  let relativeStopLoss: number | null = null;
  let relativeTakeProfit: number | null = null;
  if (args.stopLoss != null && Number.isFinite(args.stopLoss)) {
    const dist =
      args.side === "BUY" ? args.entry - args.stopLoss : args.stopLoss - args.entry;
    if (dist > 0) relativeStopLoss = Math.round(dist * SPOT_PRICE_SCALE);
  }
  if (args.takeProfit != null && Number.isFinite(args.takeProfit)) {
    const dist =
      args.side === "BUY"
        ? args.takeProfit - args.entry
        : args.entry - args.takeProfit;
    if (dist > 0) relativeTakeProfit = Math.round(dist * SPOT_PRICE_SCALE);
  }
  return { relativeStopLoss, relativeTakeProfit };
}

function assertLiveAccountAllowed(accountId: string): void {
  assertAccountAllowlisted(accountId);
  const allow = parseAccountAllowlist();
  if (allow.length > 0) return;
  if (!String(accountId).endsWith("06")) {
    throw Object.assign(new Error("CTRADER_LIVE_ACCOUNT_NOT_06"), {
      code: "CTRADER_LIVE_ACCOUNT_NOT_06"
    });
  }
}

function classifySignalFreshness(
  generatedAt: string | null,
  maxSignalAgeSeconds: number
): SignalFreshnessClass {
  if (!generatedAt) return "STALE_SIGNAL";
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return "STALE_SIGNAL";
  const age = Math.max(0, Math.round((Date.now() - t) / 1000));
  return age <= maxSignalAgeSeconds ? "FRESH_SIGNAL" : "STALE_SIGNAL";
}

/** Resolve cash risk from existing GoldMeta AutoTrade settings only. */
export function resolveRiskFromSettings(args: {
  fixedRiskAmount: number | null | undefined;
  percentageRisk: number | null | undefined;
  equity: number | null;
  sizingMode: string | null | undefined;
}): {
  ok: boolean;
  riskAmount: number | null;
  riskPercent: number | null;
  maxCashRisk: number | null;
  reason: string | null;
} {
  const pct =
    args.percentageRisk != null && Number.isFinite(args.percentageRisk)
      ? args.percentageRisk
      : null;
  const fixed =
    args.fixedRiskAmount != null && Number.isFinite(args.fixedRiskAmount)
      ? args.fixedRiskAmount
      : null;

  if (
    (fixed == null || !(fixed > 0)) &&
    (pct == null || !(pct > 0))
  ) {
    return {
      ok: false,
      riskAmount: null,
      riskPercent: pct,
      maxCashRisk: null,
      reason: "RISK_CONFIGURATION_MISSING"
    };
  }

  // Existing sizing path uses fixedRiskAmount as the cash risk input.
  const riskAmount = fixed != null && fixed > 0 ? fixed : null;
  const maxFromPct =
    pct != null && args.equity != null && args.equity > 0
      ? Number(((args.equity * pct) / 100).toFixed(2))
      : null;
  const maxCashRisk = riskAmount ?? maxFromPct;

  if (args.sizingMode === "automatic_risk" && (riskAmount == null || !(riskAmount > 0))) {
    return {
      ok: false,
      riskAmount: null,
      riskPercent: pct,
      maxCashRisk,
      reason: "RISK_CONFIGURATION_MISSING"
    };
  }

  return {
    ok: true,
    riskAmount,
    riskPercent: pct,
    maxCashRisk,
    reason: null
  };
}

function buildWouldBePayload(args: {
  accountMasked: string;
  symbolId: string;
  side: "BUY" | "SELL";
  volumeUnits: number;
  relativeStopLoss: number | null;
  relativeTakeProfit: number | null;
  decisionId: string;
}): CTraderWouldBeOrderPayload {
  return {
    ctidTraderAccountIdMasked: args.accountMasked,
    symbolId: Number(args.symbolId),
    orderType: 1,
    tradeSide: args.side === "BUY" ? 1 : 2,
    volume: args.volumeUnits,
    relativeStopLoss: args.relativeStopLoss,
    relativeTakeProfit: args.relativeTakeProfit,
    clientOrderId: `gm_shadow_${randomBytes(8).toString("hex")}`.slice(0, 50),
    label: "GoldMeta LIVE SHADOW",
    comment: `SHADOW only — decision ${args.decisionId} — NOT SUBMITTED`
  };
}

function emptyBase(args: {
  intentKey: string;
  ownerUid: string;
  decision: DecisionRecord;
  plan: LiveShadowPlanSnapshot;
  outcome: LiveShadowExecutionRecord["outcome"];
  passedGates: string[];
  failedGates: string[];
  accountMasked: string | null;
  symbolId: string | null;
  symbolName: string | null;
  wouldSubmit: LiveShadowWouldSubmitOrder | null;
  balance: number | null;
  equity: number | null;
  freeMargin: number | null;
  usedMargin: number | null;
  currency: string | null;
  leverage: number | null;
  openPositionsCount: number | null;
  pendingOrdersCount: number | null;
  signalFreshnessClass: SignalFreshnessClass | null;
  decisionTimestamp: string | null;
  quoteTimestamp: string | null;
  executableEntry: number | null;
  calculatedSlippage: number | null;
  maxSlippageAllowed: number | null;
  riskAmount: number | null;
  riskPercent: number | null;
  stopDistance: number | null;
  rawLotSize: number | null;
  roundedLotSize: number | null;
  volumeUnits: number | null;
  marginEligible: boolean | null;
  duplicateCheck: LiveShadowExecutionRecord["duplicateCheck"];
  reconcileOk: boolean | null;
  marketOpen: boolean | null;
}): LiveShadowExecutionRecord {
  const now = new Date().toISOString();
  return {
    intentKey: args.intentKey,
    ownerUid: args.ownerUid,
    decisionId: args.decision.decisionId,
    decision: args.decision.decision,
    confidence: args.decision.confidence,
    outcome: args.outcome,
    mode: "SHADOW",
    liveOrderEndpointCalled: false,
    isCTraderLiveEnabled: false,
    isCTraderLiveExecutionOwnerApproved: false,
    protoOANewOrderReqCallCount: 0,
    accountMasked: args.accountMasked,
    symbolId: args.symbolId,
    symbolName: args.symbolName,
    wouldSubmit: args.wouldSubmit,
    plan: args.plan,
    signalFreshnessClass: args.signalFreshnessClass,
    decisionTimestamp: args.decisionTimestamp,
    quoteTimestamp: args.quoteTimestamp,
    executableEntry: args.executableEntry,
    calculatedSlippage: args.calculatedSlippage,
    maxSlippageAllowed: args.maxSlippageAllowed,
    riskAmount: args.riskAmount,
    riskPercent: args.riskPercent,
    stopDistance: args.stopDistance,
    rawLotSize: args.rawLotSize,
    roundedLotSize: args.roundedLotSize,
    volumeUnits: args.volumeUnits,
    marginEligible: args.marginEligible,
    duplicateCheck: args.duplicateCheck,
    reconcileOk: args.reconcileOk,
    marketOpen: args.marketOpen,
    passedGates: args.passedGates,
    failedGates: args.failedGates,
    rejectionReasons: [...args.failedGates],
    balance: args.balance,
    equity: args.equity,
    freeMargin: args.freeMargin,
    usedMargin: args.usedMargin,
    currency: args.currency,
    leverage: args.leverage,
    openPositionsCount: args.openPositionsCount,
    pendingOrdersCount: args.pendingOrdersCount,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Evaluate one stored decision in LIVE SHADOW mode.
 * Safe to call from the decision-created trigger; never submits orders.
 */
export async function processDecisionForLiveShadow(args: {
  userId: string;
  decisionId: string;
  store: GoldMetaStore;
  api?: CTraderOpenApiClient;
  /** When true, evaluate even if CTRADER_LIVE_SHADOW_ENABLED is unset (scripts). */
  force?: boolean;
}): Promise<LiveShadowProcessResult> {
  const { userId, decisionId, store } = args;

  if (!args.force && !isCTraderLiveShadowEnabled()) {
    return {
      skipped: true,
      outcome: "SHADOW_DISABLED",
      intentKey: null,
      record: null,
      message: "CTRADER_LIVE_SHADOW_ENABLED is not true"
    };
  }

  assertCTraderLiveMutationsDisabled();
  if (isCTraderLiveEnabled() || isCTraderLiveExecutionOwnerApproved()) {
    throw new Error("CTRADER_LIVE_MUST_REMAIN_FALSE_DURING_SHADOW");
  }

  try {
    assertBrokerUser(userId);
  } catch {
    return {
      skipped: true,
      outcome: "SHADOW_SKIPPED",
      intentKey: null,
      record: null,
      message: "Not the pinned broker owner"
    };
  }

  const decision = await store.getDecision(userId, decisionId);
  if (!decision) {
    return {
      skipped: true,
      outcome: "SHADOW_SKIPPED",
      intentKey: null,
      record: null,
      message: "Decision not found"
    };
  }

  const d = String(decision.decision).toUpperCase();
  if (d !== "BUY" && d !== "SELL") {
    return {
      skipped: true,
      outcome: "SHADOW_SKIPPED",
      intentKey: null,
      record: null,
      message: `Decision ${d} is not an open signal`
    };
  }

  const connection = await getConnection(userId);
  if (!connection?.selectedAccountId || !connection.selectedAccountIsLive) {
    return {
      skipped: true,
      outcome: "SHADOW_SKIPPED",
      intentKey: null,
      record: null,
      message: "No LIVE account selected"
    };
  }

  const plan = extractPlanSnapshot(decision);
  const passedGates: string[] = [];
  const failedGates: string[] = [];
  const accountMasked = maskAccountForShadow(connection.selectedAccountId);

  try {
    assertLiveAccountAllowed(connection.selectedAccountId);
    passedGates.push("ACCOUNT_ALLOWLISTED");
  } catch {
    failedGates.push("ACCOUNT_NOT_ALLOWLISTED");
  }

  if (connection.environment !== "LIVE" || !connection.selectedAccountIsLive) {
    failedGates.push("ACCOUNT_NOT_LIVE");
  } else passedGates.push("ACCOUNT_LIVE");

  if (!connection.brokerConfirmedPepperstone) {
    failedGates.push("PEPPERSTONE_NOT_CONFIRMED");
  } else passedGates.push("PEPPERSTONE_OK");

  if (!String(connection.selectedAccountId).endsWith("06")) {
    failedGates.push("ACCOUNT_NOT_06");
  } else passedGates.push("ACCOUNT_IS_06");

  const settings = await getUserAutoTradeSettings(userId, "live");
  if (settings.emergencyStopActive) {
    failedGates.push("EMERGENCY_STOP");
  } else passedGates.push("EMERGENCY_STOP_CLEAR");

  if (
    settings.selectedAccountId &&
    settings.selectedAccountId !== connection.selectedAccountId
  ) {
    failedGates.push("EXECUTION_ACCOUNT_MISMATCH");
  } else passedGates.push("SINGLE_EXECUTION_ACCOUNT");

  const intentKey = buildIntentKey({
    ownerUid: userId,
    broker: "pepperstone_ctrader",
    accountId: connection.selectedAccountId,
    environment: "LIVE",
    decisionId: decision.decisionId,
    symbolId: connection.symbolId ?? "unknown",
    action: d
  });

  const side = d as "BUY" | "SELL";
  let balance: number | null = null;
  let equity: number | null = null;
  let freeMargin: number | null = null;
  let usedMargin: number | null = null;
  let currency: string | null = connection.currency ?? null;
  let leverage: number | null = null;
  let openPositionsCount: number | null = null;
  let pendingOrdersCount: number | null = null;
  let symbol: BrokerSymbol | null = null;
  let quote: BrokerQuote | null = null;
  let quoteFreshness: string | null = null;
  let quoteSequence: number | null = null;
  let brokerTimestamp: string | null = null;
  let wouldSubmit: LiveShadowWouldSubmitOrder | null = null;
  let reconcileOk: boolean | null = null;
  let marketOpen: boolean | null = null;
  let calculatedSlippage: number | null = null;
  let maxSlippageAllowed: number | null = null;
  let riskAmount: number | null = null;
  let riskPercent: number | null = null;
  let stopDistance: number | null = null;
  let rawLotSize: number | null = null;
  let roundedLotSize: number | null = null;
  let volumeUnits: number | null = null;
  let marginEligible: boolean | null = null;
  let executableEntry: number | null = null;

  const maxSignalAgeSeconds =
    settings.maxQuoteAgeSeconds ?? CTRADER_RECOMMENDED_DEFAULTS.maxSignalAgeSeconds;
  const signalFreshnessClass = classifySignalFreshness(
    decision.generatedAt ?? null,
    maxSignalAgeSeconds
  );

  try {
    const api = args.api ?? createOpenApiClient();
    const { accessToken, connection: freshConn } =
      await ensureFreshAccessToken(connection);
    const { clientId, clientSecret } = clientCreds();
    if (!clientId || !clientSecret) {
      failedGates.push("CONFIGURATION_REQUIRED");
    } else {
      const snap = await api.fetchAccountSnapshot({
        accessToken,
        clientId,
        clientSecret,
        ctidTraderAccountId: freshConn.selectedAccountId!,
        isLive: true
      });
      balance = snap.balance;
      equity = snap.equity;
      freeMargin = snap.freeMargin;
      usedMargin = snap.usedMargin ?? null;
      currency = snap.currency ?? currency;
      leverage = snap.leverage ?? null;

      if (balance == null || equity == null) {
        failedGates.push("BALANCE_EQUITY_INVALID");
      } else if (!(equity > 0)) {
        // Do not invent fallback equity or position size.
        failedGates.push("ACCOUNT_EQUITY_ZERO");
      } else {
        passedGates.push("BALANCE_EQUITY_OK");
      }

      let recon: TradingReconcileState | null = null;
      try {
        recon = await api.reconcileTradingState({
          accessToken,
          clientId,
          clientSecret,
          ctidTraderAccountId: freshConn.selectedAccountId!,
          isLive: true
        });
        openPositionsCount = recon.openPositionsCount;
        pendingOrdersCount = recon.pendingOrdersCount;
        if (recon.freeMargin != null) freeMargin = recon.freeMargin;
        if (recon.equity != null) equity = recon.equity;
        if (recon.usedMargin != null) usedMargin = recon.usedMargin;
        reconcileOk = true;
        passedGates.push("RECONCILE_OK");

        if (pendingOrdersCount > 0) {
          failedGates.push("PENDING_ORDER_CONFLICT");
        } else {
          passedGates.push("NO_PENDING_ORDERS");
        }

        const xauId = String(freshConn.symbolId ?? "");
        const hasXauConflict =
          recon.openPositionsCount > 0 &&
          (recon.openSymbolIds.length === 0 ||
            recon.openSymbolIds.some((id) => id === xauId || id === "41"));
        if (hasXauConflict && recon.openPositionsCount > 0) {
          // Preview also enforces maxOpenPositions; mark conflicting managed book.
          if (
            xauId &&
            recon.openSymbolIds.includes(xauId)
          ) {
            failedGates.push("CONFLICTING_GOLDMETA_POSITION");
          }
        }
      } catch {
        reconcileOk = false;
        failedGates.push("RECONCILE_FAILED");
      }

      symbol = await api.discoverXauUsd({
        accessToken,
        clientId,
        clientSecret,
        ctidTraderAccountId: freshConn.selectedAccountId!,
        isLive: true
      });
      if (!symbol || !symbol.metadataComplete) {
        failedGates.push("SYMBOL_METADATA_INCOMPLETE");
      } else passedGates.push("SYMBOL_OK");
    }

    const stored = await getStoredAuthoritativeQuote(userId);
    if (!stored) {
      failedGates.push("QUOTE_UNAVAILABLE");
    } else {
      const fresh = refreshAuthoritativeFreshness(stored);
      quote = toBrokerQuote(fresh);
      quoteFreshness = fresh.freshness;
      quoteSequence = fresh.quoteSequence;
      brokerTimestamp = fresh.brokerTimestamp;
      marketOpen = fresh.marketStatus === "OPEN";
      if (fresh.environment !== "LIVE") {
        failedGates.push("QUOTE_NOT_FROM_LIVE");
      } else passedGates.push("QUOTE_ENVIRONMENT_LIVE");
      if (
        !fresh.executable ||
        !isQuoteExecutableForAutoTrade(fresh.freshness, fresh.marketStatus)
      ) {
        failedGates.push("QUOTE_NOT_EXECUTABLE");
      } else passedGates.push("QUOTE_EXECUTABLE");
      if (fresh.marketStatus === "OPEN") passedGates.push("MARKET_OPEN");
      else if (fresh.marketStatus === "CLOSED") failedGates.push("MARKET_CLOSED");
      else failedGates.push("MARKET_STATUS_UNKNOWN");
    }

    const stopLoss = plan.stopLoss;
    const takeProfit1 = plan.takeProfit1;
    const takeProfit2 = plan.takeProfit2;
    const takeProfit3 = plan.takeProfit3;
    const entry =
      quote?.bid != null && quote.ask != null
        ? executableEntryPrice(side, { bid: quote.bid, ask: quote.ask })
        : null;
    executableEntry = entry;

    if (entry != null) {
      const ladderFails = validateStopTpLadder({
        side,
        entry,
        stopLoss,
        takeProfit1,
        takeProfit2,
        takeProfit3
      });
      failedGates.push(...ladderFails);
      if (ladderFails.length === 0) {
        passedGates.push("STOP_TP_ORDERING_OK");
      }
    }

    // Slippage vs plan entry — do not chase the market.
    const planEntry = plan.plannedEntry;
    maxSlippageAllowed =
      Number(process.env.CTRADER_LIVE_SHADOW_MAX_SLIPPAGE ?? "") ||
      DEFAULT_MAX_SLIPPAGE;
    if (entry != null && planEntry != null && Number.isFinite(planEntry)) {
      calculatedSlippage = Math.abs(entry - planEntry);
      if (calculatedSlippage > maxSlippageAllowed) {
        failedGates.push("SLIPPAGE_TOO_HIGH");
      } else {
        passedGates.push("SLIPPAGE_OK");
      }
    }

    const riskResolved = resolveRiskFromSettings({
      fixedRiskAmount: settings.fixedRiskAmount,
      percentageRisk: settings.percentageRisk,
      equity,
      sizingMode: settings.sizingMode
    });
    riskPercent = riskResolved.riskPercent;
    riskAmount = riskResolved.riskAmount;
    if (!riskResolved.ok) {
      failedGates.push(riskResolved.reason ?? "RISK_CONFIGURATION_MISSING");
    } else {
      passedGates.push("RISK_CONFIGURATION_OK");
    }

    if (entry != null && stopLoss != null) {
      stopDistance = Math.abs(entry - stopLoss);
    }

    // Freshness classification is recorded separately from gate failure.
    if (signalFreshnessClass === "FRESH_SIGNAL") {
      passedGates.push("FRESH_SIGNAL");
    } else {
      // Historical/replayed signals stay STALE — not an execution-layer defect.
      failedGates.push("SIGNAL_STALE");
      passedGates.push("STALE_SIGNAL_CLASSIFIED");
    }

    const preview = buildTradePreview({
      decisionId: decision.decisionId,
      decision: d,
      confidence: decision.confidence,
      generatedAt: decision.generatedAt,
      candleConfirmed: candleConfirmed(decision),
      stopLoss,
      takeProfits: takeProfit1 != null ? [takeProfit1] : [],
      symbol,
      quote,
      position: null,
      pendingOrdersCount: pendingOrdersCount ?? 0,
      openPositionsCount: openPositionsCount ?? 0,
      tradesToday: 0,
      equity,
      freeMargin,
      accountCurrency: currency ?? "EUR",
      riskAmountEur: riskAmount ?? 0,
      maxSpread: settings.maxSpread,
      demonstration: false,
      eurToAccountRate: 1,
      marginPerLot: null,
      sizingMode: settings.sizingMode,
      manualLotSize: settings.manualLotSize,
      minConfidence: settings.minConfidence,
      maxQuoteAgeSeconds: settings.maxQuoteAgeSeconds,
      maxOpenPositions: settings.maxOpenPositions,
      maxTradesPerDay: settings.maxTradesPerDay,
      confirmationCandleRequired: settings.confirmationCandleRequired
    });

    for (const g of preview.passedGates) {
      if (!passedGates.includes(g)) passedGates.push(g);
    }
    for (const g of preview.failedGates) {
      // Avoid double-counting SIGNAL_STALE from preview when already classified.
      if (!failedGates.includes(g)) failedGates.push(g);
    }

    if (freeMargin == null) {
      marginEligible = null;
    } else if (preview.estimatedMargin != null) {
      marginEligible = preview.estimatedMargin <= freeMargin + 1e-6;
      if (marginEligible) passedGates.push("MARGIN_ELIGIBLE");
      else failedGates.push("INSUFFICIENT_FREE_MARGIN");
    } else {
      marginEligible = null;
    }

    // Always capture the calculated order shape for audit (even when blocked).
    if (symbol && entry != null) {
      const prot = relativeProtection({
        side,
        entry,
        stopLoss,
        takeProfit: takeProfit1
      });

      // Raw lot size from existing risk formula (evidence) — never invent when equity=0.
      if (
        riskAmount != null &&
        riskAmount > 0 &&
        equity != null &&
        equity > 0 &&
        stopDistance != null &&
        stopDistance > 0 &&
        symbol.lotSize != null &&
        symbol.volumeStep != null
      ) {
        rawLotSize = riskAmount / (symbol.lotSize * stopDistance);
        roundedLotSize = roundDownLotsToStep(rawLotSize, symbol.volumeStep);
      }

      let lots = preview.proposedVolume ?? roundedLotSize;
      if (lots != null) {
        try {
          const step = symbol.volumeStep ?? 0.01;
          const minLots = symbol.minVolume ?? step;
          const maxLots = symbol.maxVolume ?? 100;
          const rules = validateLotsAgainstRules(lots, {
            rawMinVolume: minLots * 100,
            rawMaxVolume: maxLots * 100,
            rawStepVolume: step * 100,
            rawLotSize: (symbol.lotSize ?? 100) * 100,
            apiVolumeScalingFactor: 100,
            minLots,
            maxLots,
            stepLots: step,
            contractSize: symbol.lotSize ?? 100,
            orderVolumeUnitsPerLot: 100
          });
          if (!rules.ok || rules.orderVolumeUnits == null || rules.roundedLots == null) {
            failedGates.push(rules.rejectionReason ?? "VOLUME_CONVERSION_INVALID");
          } else {
            passedGates.push("VOLUME_CONVERSION_OK");
            lots = rules.roundedLots;
            roundedLotSize = rules.roundedLots;
            volumeUnits = rules.orderVolumeUnits;
          }
        } catch {
          failedGates.push("VOLUME_CONVERSION_INVALID");
        }
      }

      const takeProfitsList = [
        takeProfit1 != null ? { label: "TP1", price: takeProfit1 } : null,
        takeProfit2 != null ? { label: "TP2", price: takeProfit2 } : null,
        takeProfit3 != null ? { label: "TP3", price: takeProfit3 } : null
      ].filter((x): x is { label: string; price: number } => x != null);

      const masked =
        accountMasked ?? maskAccountId(connection.selectedAccountId);
      const payload =
        volumeUnits != null && volumeUnits > 0
          ? buildWouldBePayload({
              accountMasked: masked,
              symbolId: symbol.symbolId,
              side,
              volumeUnits,
              relativeStopLoss: prot.relativeStopLoss,
              relativeTakeProfit: prot.relativeTakeProfit,
              decisionId: decision.decisionId
            })
          : volumeUnits != null
            ? buildWouldBePayload({
                accountMasked: masked,
                symbolId: symbol.symbolId,
                side,
                volumeUnits: volumeUnits || 0,
                relativeStopLoss: prot.relativeStopLoss,
                relativeTakeProfit: prot.relativeTakeProfit,
                decisionId: decision.decisionId
              })
            : null;

      wouldSubmit = {
        side,
        symbolId: symbol.symbolId,
        symbolName: symbol.symbolName,
        lots: lots ?? 0,
        volumeUnits: volumeUnits ?? 0,
        entry,
        stopLoss,
        takeProfit: takeProfit1,
        takeProfits: takeProfitsList,
        relativeStopLoss: prot.relativeStopLoss,
        relativeTakeProfit: prot.relativeTakeProfit,
        accountMasked: masked,
        environment: "LIVE",
        spread: quote?.spread ?? null,
        bid: quote?.bid ?? null,
        ask: quote?.ask ?? null,
        quoteFreshness,
        quoteSequence,
        brokerTimestamp,
        plannedEntry: planEntry,
        slippage: calculatedSlippage,
        riskAmount,
        riskPercent,
        stopDistance,
        rawLotSize,
        roundedLotSize,
        ctraderOrderPayload: payload
      };
    }

    const finalFailed = [...new Set(failedGates)];
    const uniqPassed = [...new Set(passedGates)];
    const outcome: LiveShadowExecutionRecord["outcome"] =
      finalFailed.length === 0 &&
      wouldSubmit != null &&
      wouldSubmit.lots > 0 &&
      wouldSubmit.volumeUnits > 0 &&
      wouldSubmit.ctraderOrderPayload != null
        ? "SHADOW_WOULD_SUBMIT"
        : "SHADOW_BLOCKED";

    if (isCTraderLiveEnabled() || isCTraderLiveExecutionOwnerApproved()) {
      throw new Error("CTRADER_LIVE_MUST_REMAIN_FALSE");
    }

    const record = emptyBase({
      intentKey,
      ownerUid: userId,
      decision,
      plan,
      outcome,
      passedGates: uniqPassed,
      failedGates: finalFailed,
      accountMasked,
      symbolId: symbol?.symbolId ?? connection.symbolId,
      symbolName: symbol?.symbolName ?? connection.symbolName ?? "XAUUSD",
      wouldSubmit,
      balance,
      equity,
      freeMargin,
      usedMargin,
      currency,
      leverage,
      openPositionsCount,
      pendingOrdersCount,
      signalFreshnessClass,
      decisionTimestamp: decision.generatedAt ?? null,
      quoteTimestamp: brokerTimestamp ?? quote?.timestamp ?? null,
      executableEntry,
      calculatedSlippage,
      maxSlippageAllowed,
      riskAmount,
      riskPercent,
      stopDistance,
      rawLotSize,
      roundedLotSize,
      volumeUnits,
      marginEligible,
      duplicateCheck: "NEW",
      reconcileOk,
      marketOpen
    });
    record.rejectionReasons = outcome === "SHADOW_BLOCKED" ? finalFailed : [];
    // Absolute guarantee: NewOrder call count stays zero.
    record.protoOANewOrderReqCallCount = 0;
    record.liveOrderEndpointCalled = false;

    const persisted = await persistLiveShadowExecution(record);
    if (!persisted.created) {
      return {
        skipped: false,
        outcome: "SHADOW_DUPLICATE",
        intentKey,
        record: persisted.record,
        message: "Duplicate intent — prior shadow evaluation retained"
      };
    }

    logger.info("LIVE SHADOW evaluation persisted", {
      userId,
      decisionId,
      outcome: record.outcome,
      accountMasked,
      signalFreshnessClass,
      failedGates: record.failedGates,
      liveOrderEndpointCalled: false,
      protoOANewOrderReqCallCount: 0
    });

    return {
      skipped: false,
      outcome: record.outcome,
      intentKey,
      record,
      message:
        record.outcome === "SHADOW_WOULD_SUBMIT"
          ? "Shadow would submit — live order endpoint NOT called"
          : `Shadow blocked: ${record.failedGates.join(",")}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logger.error("LIVE SHADOW evaluation failed", {
      userId,
      decisionId,
      error: message
    });
    const record = emptyBase({
      intentKey,
      ownerUid: userId,
      decision,
      plan,
      outcome: "SHADOW_BLOCKED",
      passedGates,
      failedGates: [...failedGates, "SHADOW_EVAL_ERROR"],
      accountMasked,
      symbolId: connection.symbolId,
      symbolName: connection.symbolName,
      wouldSubmit: null,
      balance,
      equity,
      freeMargin,
      usedMargin,
      currency,
      leverage,
      openPositionsCount,
      pendingOrdersCount,
      signalFreshnessClass,
      decisionTimestamp: decision.generatedAt ?? null,
      quoteTimestamp: brokerTimestamp,
      executableEntry,
      calculatedSlippage,
      maxSlippageAllowed,
      riskAmount,
      riskPercent,
      stopDistance,
      rawLotSize,
      roundedLotSize,
      volumeUnits,
      marginEligible,
      duplicateCheck: "UNKNOWN",
      reconcileOk,
      marketOpen
    });
    try {
      await persistLiveShadowExecution(record);
    } catch {
      /* best-effort */
    }
    return {
      skipped: false,
      outcome: "ERROR",
      intentKey,
      record,
      message
    };
  }
}
