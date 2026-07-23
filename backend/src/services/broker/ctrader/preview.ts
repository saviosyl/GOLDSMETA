/**
 * Trade preview engine — never submits orders.
 * PREVIEW_APPROVED must not trigger broker mutation.
 */

import { createHash, randomBytes } from "node:crypto";
import type { BrokerPosition, BrokerQuote, BrokerSymbol, TradePreview } from "../domain";
import { CTRADER_DEMO_SERVER_LIMITS } from "./flags";
import { mapDecisionToCTraderAction } from "./decisionMapping";
import { calculateCTraderVolume } from "./sizing";

export interface PreviewInput {
  decisionId: string;
  decision: string;
  confidence: number | null;
  generatedAt: string | null;
  candleConfirmed: boolean;
  stopLoss: number | null;
  takeProfits: number[];
  symbol: BrokerSymbol | null;
  quote: BrokerQuote | null;
  position: BrokerPosition | null;
  pendingOrdersCount: number;
  equity: number | null;
  freeMargin: number | null;
  accountCurrency: string;
  riskAmountEur: number;
  maxSpread: number | null;
  demonstration?: boolean;
  eurToAccountRate?: number | null;
  marginPerLot?: number | null;
}

function ageSeconds(generatedAt: string | null): number | null {
  if (!generatedAt) return null;
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

export function buildTradePreview(input: PreviewInput): TradePreview {
  const passed: string[] = [];
  const failed: string[] = [];
  const demo = Boolean(input.demonstration);
  const age = ageSeconds(input.generatedAt);

  const positionSide =
    input.position == null
      ? "FLAT"
      : input.position.direction === "LONG"
        ? "LONG"
        : "SHORT";

  const mapped = mapDecisionToCTraderAction({
    decision: input.decision,
    position: positionSide,
    oppositePolicy: "CLOSE_ONLY"
  });

  if (mapped.action === "WAIT" && mapped.brokerMutation === "NONE") {
    if (String(input.decision).toUpperCase() === "WAIT") passed.push("WAIT_NO_ORDER");
    else failed.push(mapped.reason);
  } else if (!mapped.allowed) {
    failed.push(mapped.reason);
  } else {
    passed.push(`ACTION_${mapped.action}`);
  }

  if (!input.symbol || !input.symbol.metadataComplete) {
    failed.push("SYMBOL_METADATA_INCOMPLETE");
  } else passed.push("SYMBOL_OK");

  if (!input.quote || input.quote.bid == null || input.quote.ask == null) {
    failed.push("QUOTE_UNAVAILABLE");
  } else if (input.quote.stale || input.quote.source === "FIXTURE") {
    if (demo) passed.push("FIXTURE_QUOTE_DEMO_ONLY");
    else failed.push("QUOTE_NOT_LIVE");
  } else if (input.quote.marketStatus !== "OPEN") {
    failed.push(
      input.quote.marketStatus === "CLOSED" ? "MARKET_CLOSED" : "MARKET_STATUS_UNKNOWN"
    );
  } else {
    passed.push("MARKET_OPEN");
  }

  if (
    input.confidence == null ||
    input.confidence < CTRADER_DEMO_SERVER_LIMITS.minConfidence
  ) {
    failed.push("CONFIDENCE_TOO_LOW");
  } else passed.push("CONFIDENCE_OK");

  if (age == null || age > CTRADER_DEMO_SERVER_LIMITS.maxSignalAgeSeconds) {
    failed.push("SIGNAL_STALE");
  } else passed.push("SIGNAL_FRESH");

  if (CTRADER_DEMO_SERVER_LIMITS.confirmedCandleRequired && !input.candleConfirmed) {
    failed.push("CANDLE_CONFIRMATION_REQUIRED");
  } else if (input.candleConfirmed) passed.push("CANDLE_CONFIRMED");

  if (
    input.maxSpread != null &&
    input.quote?.spread != null &&
    input.quote.spread > input.maxSpread
  ) {
    failed.push("SPREAD_TOO_WIDE");
  }

  if (input.pendingOrdersCount > 0) failed.push("PENDING_ORDER_CONFLICT");
  else passed.push("NO_PENDING_ORDERS");

  const direction =
    mapped.brokerMutation === "OPEN_LONG" || mapped.brokerMutation === "CLOSE_SHORT"
      ? "LONG"
      : mapped.brokerMutation === "OPEN_SHORT" || mapped.brokerMutation === "CLOSE_LONG"
        ? "SHORT"
        : mapped.action === "WAIT"
          ? "NONE"
          : "FLAT";

  const entry =
    input.quote == null
      ? null
      : mapped.brokerMutation === "OPEN_LONG"
        ? input.quote.ask
        : mapped.brokerMutation === "OPEN_SHORT"
          ? input.quote.bid
          : input.quote.bid;

  let sizing = null;
  if (
    (mapped.brokerMutation === "OPEN_LONG" || mapped.brokerMutation === "OPEN_SHORT") &&
    input.symbol
  ) {
    sizing = calculateCTraderVolume({
      equity: input.equity,
      freeMargin: input.freeMargin,
      accountCurrency: input.accountCurrency,
      riskAmountEur: Math.min(
        input.riskAmountEur,
        CTRADER_DEMO_SERVER_LIMITS.maxRiskPerTradeEur
      ),
      entryPrice: entry,
      stopLoss: input.stopLoss,
      lotSize: input.symbol.lotSize,
      tickSize: input.symbol.tickSize,
      minVolume: input.symbol.minVolume,
      volumeStep: input.symbol.volumeStep,
      maxVolume: input.symbol.maxVolume,
      marginPerLot: input.marginPerLot ?? null,
      eurToAccountRate: input.eurToAccountRate ?? (input.accountCurrency === "EUR" ? 1 : null)
    });
    if (!sizing.ok && sizing.rejectionReason) failed.push(sizing.rejectionReason);
    else if (sizing.ok) passed.push("SIZING_OK");
  }

  // Close actions do not need open sizing
  if (
    mapped.brokerMutation === "CLOSE_LONG" ||
    mapped.brokerMutation === "CLOSE_SHORT"
  ) {
    if (input.position) passed.push("CLOSE_TARGET_PRESENT");
    else failed.push("NO_POSITION_TO_CLOSE");
  }

  const blocked = failed.length > 0 || mapped.brokerMutation === "NONE";
  const state = blocked ? "BLOCKED" : "READY_FOR_CONFIRMATION";

  const stopDistance =
    sizing?.stopDistance ??
    (entry != null && input.stopLoss != null
      ? Math.abs(entry - input.stopLoss)
      : null);

  return {
    previewId: `prev_${randomBytes(8).toString("hex")}`,
    state,
    action: mapped.action,
    direction,
    symbolName: input.symbol?.symbolName ?? "XAUUSD",
    decisionId: input.decisionId,
    decisionTimestamp: input.generatedAt,
    decisionAgeSeconds: age,
    confidence: input.confidence,
    bid: input.quote?.bid ?? null,
    ask: input.quote?.ask ?? null,
    spread: input.quote?.spread ?? null,
    intendedEntry: entry,
    stopLoss: input.stopLoss,
    takeProfits: input.takeProfits,
    stopDistance,
    riskAmount: sizing?.riskAmount ?? null,
    proposedVolume: sizing?.volume ?? null,
    estimatedMargin: sizing?.estimatedMargin ?? null,
    estimatedCommission: null,
    estimatedMaxLoss: sizing?.estimatedMaxLoss ?? null,
    estimatedRiskReward:
      stopDistance && input.takeProfits[0] != null && entry != null
        ? Number(
            (Math.abs(input.takeProfits[0] - entry) / stopDistance).toFixed(2)
          )
        : null,
    equity: input.equity,
    freeMargin: input.freeMargin,
    existingPosition: input.position,
    pendingOrdersCount: input.pendingOrdersCount,
    marketStatus: input.quote?.marketStatus ?? "UNKNOWN",
    passedGates: passed,
    failedGates: failed,
    demonstration: demo,
    orderSubmissionEnabled: false,
    label: demo
      ? "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED"
      : "TRADING DISABLED — NO ORDER CAN BE SUBMITTED"
  };
}

/** Approving a preview never enables submission. */
export function approveTradePreview(preview: TradePreview): TradePreview {
  if (preview.state === "BLOCKED" || preview.state === "EXPIRED" || preview.state === "CANCELLED") {
    return preview;
  }
  return {
    ...preview,
    state: "PREVIEW_APPROVED",
    orderSubmissionEnabled: false,
    label: preview.demonstration
      ? "DEMONSTRATION DATA — PREVIEW APPROVED — NO ORDER PLACED"
      : "PREVIEW APPROVED — ORDER SUBMISSION REMAINS DISABLED"
  };
}

export function buildIntentKey(args: {
  ownerUid: string;
  broker: string;
  accountId: string;
  environment: string;
  decisionId: string;
  symbolId: string;
  action: string;
}): string {
  const material = [
    args.ownerUid,
    args.broker,
    args.accountId,
    args.environment,
    args.decisionId,
    args.symbolId,
    args.action
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}
