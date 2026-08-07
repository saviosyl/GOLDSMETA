/**
 * Pepperstone LIVE AutoTrade SHADOW execution layer.
 *
 * Processes genuine GoldMeta BUY/SELL decisions against the selected LIVE
 * account, computes the exact market order that WOULD be submitted, and
 * persists an audit record. Never calls ProtoOANewOrderReq / Live order APIs.
 *
 * isCTraderLiveEnabled() remains hard-false.
 */

import type { DecisionRecord } from "../../../models/types";
import type { GoldMetaStore } from "../../storage/types";
import type { BrokerQuote, BrokerSymbol } from "../domain";
import { logger } from "../../logging/logger";
import {
  assertCTraderLiveMutationsDisabled,
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
import { validateLotsAgainstRules } from "./volumeUnits";
import { assertAccountAllowlisted, parseAccountAllowlist } from "./accountAllowlist";
import { maskAccountId } from "./tokenCrypto";
import {
  persistLiveShadowExecution,
  maskAccountForShadow,
  type LiveShadowExecutionRecord,
  type LiveShadowWouldSubmitOrder
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

function validateStopTpOrdering(args: {
  side: "BUY" | "SELL";
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
}): string[] {
  const failed: string[] = [];
  if (args.stopLoss == null || !Number.isFinite(args.stopLoss)) {
    failed.push("STOP_LOSS_REQUIRED");
    return failed;
  }
  if (args.takeProfit == null || !Number.isFinite(args.takeProfit)) {
    failed.push("TAKE_PROFIT_REQUIRED");
    return failed;
  }
  if (args.side === "BUY") {
    if (!(args.stopLoss < args.entry)) failed.push("STOP_ORDERING_INVALID");
    if (!(args.takeProfit > args.entry)) failed.push("TP_ORDERING_INVALID");
  } else {
    if (!(args.stopLoss > args.entry)) failed.push("STOP_ORDERING_INVALID");
    if (!(args.takeProfit < args.entry)) failed.push("TP_ORDERING_INVALID");
  }
  return failed;
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
  // When allowlist unset, still require the owner-confirmed LIVE …06 suffix.
  if (!String(accountId).endsWith("06")) {
    throw Object.assign(new Error("CTRADER_LIVE_ACCOUNT_NOT_06"), {
      code: "CTRADER_LIVE_ACCOUNT_NOT_06"
    });
  }
}

function baseRecord(args: {
  intentKey: string;
  ownerUid: string;
  decision: DecisionRecord;
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
  openPositionsCount: number | null;
  pendingOrdersCount: number | null;
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
    accountMasked: args.accountMasked,
    symbolId: args.symbolId,
    symbolName: args.symbolName,
    wouldSubmit: args.wouldSubmit,
    passedGates: args.passedGates,
    failedGates: args.failedGates,
    rejectionReasons: [...args.failedGates],
    balance: args.balance,
    equity: args.equity,
    freeMargin: args.freeMargin,
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

  // Live submission must remain impossible for the entire shadow path.
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

  // One active execution account — settings must not point at a different id.
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
  let openPositionsCount: number | null = null;
  let pendingOrdersCount: number | null = null;
  let symbol: BrokerSymbol | null = null;
  let quote: BrokerQuote | null = null;
  let quoteFreshness: string | null = null;
  let quoteSequence: number | null = null;
  let brokerTimestamp: string | null = null;
  let wouldSubmit: LiveShadowWouldSubmitOrder | null = null;

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

      if (balance == null || equity == null || !(equity > 0)) {
        failedGates.push("BALANCE_EQUITY_INVALID");
      } else passedGates.push("BALANCE_EQUITY_OK");

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
        passedGates.push("RECONCILE_OK");
      } catch {
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
      if (fresh.environment !== "LIVE") {
        failedGates.push("QUOTE_NOT_FROM_LIVE");
      } else passedGates.push("QUOTE_ENVIRONMENT_LIVE");
      if (!fresh.executable || !isQuoteExecutableForAutoTrade(fresh.freshness, fresh.marketStatus)) {
        failedGates.push("QUOTE_NOT_EXECUTABLE");
      } else passedGates.push("QUOTE_EXECUTABLE");
    }

    const stopLoss = decision.stopLoss?.price ?? null;
    const takeProfit = decision.takeProfits?.[0]?.price ?? null;
    const entry =
      quote?.bid != null && quote.ask != null
        ? executableEntryPrice(side, { bid: quote.bid, ask: quote.ask })
        : null;

    if (entry != null) {
      failedGates.push(
        ...validateStopTpOrdering({ side, entry, stopLoss, takeProfit })
      );
      if (
        !failedGates.includes("STOP_ORDERING_INVALID") &&
        !failedGates.includes("TP_ORDERING_INVALID") &&
        !failedGates.includes("STOP_LOSS_REQUIRED") &&
        !failedGates.includes("TAKE_PROFIT_REQUIRED")
      ) {
        passedGates.push("STOP_TP_ORDERING_OK");
      }
    }

    // Slippage vs plan entry
    const planEntry = decision.entry?.price ?? null;
    if (entry != null && planEntry != null && Number.isFinite(planEntry)) {
      const slip = Math.abs(entry - planEntry);
      const maxSlip =
        Number(process.env.CTRADER_LIVE_SHADOW_MAX_SLIPPAGE ?? "") ||
        DEFAULT_MAX_SLIPPAGE;
      if (slip > maxSlip) failedGates.push("SLIPPAGE_TOO_HIGH");
      else passedGates.push("SLIPPAGE_OK");
    }

    const preview = buildTradePreview({
      decisionId: decision.decisionId,
      decision: d,
      confidence: decision.confidence,
      generatedAt: decision.generatedAt,
      candleConfirmed: candleConfirmed(decision),
      stopLoss,
      takeProfits: takeProfit != null ? [takeProfit] : [],
      symbol,
      quote,
      position: null,
      pendingOrdersCount: pendingOrdersCount ?? 0,
      openPositionsCount: openPositionsCount ?? 0,
      tradesToday: 0,
      equity,
      freeMargin,
      accountCurrency: connection.currency ?? "EUR",
      riskAmountEur: settings.fixedRiskAmount,
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
      if (!failedGates.includes(g)) failedGates.push(g);
    }

    // Volume conversion + optional would-submit payload (even when blocked, for evidence)
    if (preview.proposedVolume != null && symbol && entry != null) {
      try {
        const step = symbol.volumeStep ?? 0.01;
        const minLots = symbol.minVolume ?? step;
        const maxLots = symbol.maxVolume ?? 100;
        const rules = validateLotsAgainstRules(preview.proposedVolume, {
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
          const prot = relativeProtection({
            side,
            entry,
            stopLoss,
            takeProfit
          });
          wouldSubmit = {
            side,
            symbolId: symbol.symbolId,
            symbolName: symbol.symbolName,
            lots: rules.roundedLots,
            volumeUnits: rules.orderVolumeUnits,
            entry,
            stopLoss,
            takeProfit,
            relativeStopLoss: prot.relativeStopLoss,
            relativeTakeProfit: prot.relativeTakeProfit,
            accountMasked:
              accountMasked ?? maskAccountId(connection.selectedAccountId),
            environment: "LIVE",
            spread: quote?.spread ?? null,
            bid: quote?.bid ?? null,
            ask: quote?.ask ?? null,
            quoteFreshness,
            quoteSequence,
            brokerTimestamp
          };
        }
      } catch {
        failedGates.push("VOLUME_CONVERSION_INVALID");
      }
    } else if (d === "BUY" || d === "SELL") {
      // Still attempt volume units check when sizing failed
      if (preview.proposedVolume == null) {
        /* sizing failure already in failedGates */
      }
    }

    const finalFailed = [...new Set(failedGates)];
    const uniqPassed = [...new Set(passedGates)];
    const outcome: LiveShadowExecutionRecord["outcome"] =
      finalFailed.length === 0 && wouldSubmit != null
        ? "SHADOW_WOULD_SUBMIT"
        : "SHADOW_BLOCKED";

    // Absolute guarantee: never call Live order endpoint
    if (isCTraderLiveEnabled()) {
      throw new Error("CTRADER_LIVE_MUST_REMAIN_FALSE");
    }

    const record = baseRecord({
      intentKey,
      ownerUid: userId,
      decision,
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
      openPositionsCount,
      pendingOrdersCount
    });
    record.rejectionReasons = outcome === "SHADOW_BLOCKED" ? finalFailed : [];

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
      failedGates: record.failedGates,
      liveOrderEndpointCalled: false
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
    const record = baseRecord({
      intentKey,
      ownerUid: userId,
      decision,
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
      openPositionsCount,
      pendingOrdersCount
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
