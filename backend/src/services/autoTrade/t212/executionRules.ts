/**
 * Deterministic XAUUSD → Trading 212 Invest gold instrument translation.
 * Long-only. Never opens shorts. Never auto-picks an instrument.
 */

import { createHash } from "crypto";
import {
  DEFAULT_T212_RISK_LIMITS,
  SHORT_UNSUPPORTED_REASON,
  T212_PROXY_DISCLAIMER,
  type T212DryRunPreview,
  type T212ExecutionProposal,
  type T212ProxyAction,
  type T212ProposalStatus,
  type T212RiskLimits,
  type T212SelectedInstrument,
  type T212Environment
} from "./types";
import {
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED
} from "../types";

export interface GoldMetaDecisionInput {
  decisionId: string;
  decision: string;
  confidence?: number | null;
  score?: number | null;
  generatedAt?: string | null;
  symbol?: string | null;
}

export interface T212TranslationContext {
  userId: string;
  environment: T212Environment;
  instrument: T212SelectedInstrument | null;
  holdingQuantity: number;
  freeCash: number | null;
  totalValue: number | null;
  estimatedPrice: number | null;
  marketOpen: boolean | null;
  limits?: T212RiskLimits;
  now?: Date;
}

export interface T212TranslationResult {
  action: T212ProxyAction;
  side: "BUY" | "SELL" | null;
  quantity: number | null;
  orderValue: number | null;
  status: T212ProposalStatus;
  rejectionReason: string | null;
  reasonCodes: string[];
  riskGates: string[];
  riskEvaluation: Record<string, unknown>;
}

function confidenceOf(d: GoldMetaDecisionInput): number | null {
  if (typeof d.confidence === "number") return d.confidence;
  if (typeof d.score === "number") return d.score;
  return null;
}

function signalAgeSeconds(generatedAt: string | null | undefined, now: Date): number | null {
  if (!generatedAt) return null;
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 1000));
}

export function buildIdempotencyKey(args: {
  userId: string;
  decisionId: string;
  instrumentId: string;
  action: T212ProxyAction;
  environment: T212Environment;
}): string {
  const material = [
    args.userId,
    args.decisionId,
    "T212_INVEST",
    args.environment,
    args.instrumentId,
    args.action
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

export function translateXauusdToT212Invest(
  decision: GoldMetaDecisionInput,
  ctx: T212TranslationContext
): T212TranslationResult {
  const limits = ctx.limits ?? DEFAULT_T212_RISK_LIMITS;
  const now = ctx.now ?? new Date();
  const reasonCodes: string[] = [];
  const riskGates: string[] = [];
  const riskEvaluation: Record<string, unknown> = {
    paperOrderSubmissionEnabled: T212_PAPER_ORDER_SUBMISSION_ENABLED,
    liveExecutionFeatureEnabled: T212_LIVE_EXECUTION_FEATURE_FLAG,
    disclaimer: T212_PROXY_DISCLAIMER
  };

  const block = (reason: string, extra?: string[]): T212TranslationResult => ({
    action: "WAIT",
    side: null,
    quantity: null,
    orderValue: null,
    status: "BLOCKED",
    rejectionReason: reason,
    reasonCodes: [...reasonCodes, reason, ...(extra ?? [])],
    riskGates: [...riskGates, reason],
    riskEvaluation: { ...riskEvaluation, blocked: true, reason }
  });

  if (T212_PAPER_ORDER_SUBMISSION_ENABLED || T212_LIVE_EXECUTION_FEATURE_FLAG) {
    // Fail closed even if someone flips constants incorrectly in a branch.
    return block("T212_ORDER_FLAGS_MUST_REMAIN_FALSE");
  }

  if (limits.requireSelectedInstrument && !ctx.instrument) {
    return block("SELECTED_INSTRUMENT_REQUIRED");
  }

  const conf = confidenceOf(decision);
  riskEvaluation.confidence = conf;
  if (conf != null && conf < limits.minGoldMetaConfidence) {
    return block("CONFIDENCE_TOO_LOW");
  }

  const age = signalAgeSeconds(decision.generatedAt, now);
  riskEvaluation.signalAgeSeconds = age;
  if (age != null && age > limits.maxSignalAgeSeconds) {
    return block("STALE_DECISION");
  }

  if (limits.requireMarketHours && ctx.marketOpen === false) {
    return block("MARKET_CLOSED");
  }

  const code = String(decision.decision ?? "WAIT").toUpperCase();

  if (code === "WAIT" || code === "HOLD") {
    reasonCodes.push("WAIT_NO_ORDER");
    return {
      action: "WAIT",
      side: null,
      quantity: null,
      orderValue: null,
      status: "BLOCKED",
      rejectionReason: "WAIT_NO_ORDER",
      reasonCodes,
      riskGates,
      riskEvaluation
    };
  }

  if (code === "SELL") {
    if (ctx.holdingQuantity <= 0) {
      return block(SHORT_UNSUPPORTED_REASON, ["NO_LONG_HOLDING"]);
    }
    // Eligible to reduce/close long only — still submission-disabled.
    riskGates.push("SELL_CLOSE_LONG_ONLY");
    reasonCodes.push("SELL_CLOSES_EXISTING_LONG");
    return {
      action: "SELL_CLOSE",
      side: "SELL",
      quantity: ctx.holdingQuantity,
      orderValue: null,
      status: "SUBMISSION_DISABLED",
      rejectionReason: "ORDER_SUBMISSION_DISABLED",
      reasonCodes,
      riskGates,
      riskEvaluation: {
        ...riskEvaluation,
        holdingQuantity: ctx.holdingQuantity,
        submissionDisabled: true
      }
    };
  }

  if (code === "BUY" || code === "STRONG_BUY") {
    if (limits.requireSufficientCash && ctx.freeCash != null && ctx.freeCash <= 0) {
      return block("INSUFFICIENT_FUNDS");
    }
    const orderValue = Math.min(
      limits.maxOrderValue,
      ctx.freeCash != null ? Math.max(0, ctx.freeCash) : limits.maxOrderValue
    );
    if (orderValue <= 0) {
      return block("INSUFFICIENT_FUNDS");
    }
    if (
      ctx.totalValue != null &&
      ctx.totalValue > 0 &&
      orderValue / ctx.totalValue > limits.maxOpenGoldAllocationPct / 100
    ) {
      return block("MAX_GOLD_ALLOCATION_EXCEEDED");
    }

    let quantity: number | null = null;
    if (ctx.estimatedPrice != null && ctx.estimatedPrice > 0) {
      quantity = Number((orderValue / ctx.estimatedPrice).toFixed(6));
    }

    riskGates.push("BUY_LONG_ONLY");
    reasonCodes.push("BUY_SELECTED_GOLD_INSTRUMENT");
    return {
      action: "BUY",
      side: "BUY",
      quantity,
      orderValue,
      status: "SUBMISSION_DISABLED",
      rejectionReason: "ORDER_SUBMISSION_DISABLED",
      reasonCodes,
      riskGates,
      riskEvaluation: {
        ...riskEvaluation,
        orderValue,
        submissionDisabled: true
      }
    };
  }

  return block("UNSUPPORTED_DECISION");
}

export function buildDryRunPreview(args: {
  decision: GoldMetaDecisionInput;
  translation: T212TranslationResult;
  environment: T212Environment;
  instrument: T212SelectedInstrument | null;
  accountCurrency: string | null;
}): T212DryRunPreview {
  const fxWarning =
    args.instrument &&
    args.accountCurrency &&
    args.instrument.currency &&
    args.instrument.currency !== args.accountCurrency
      ? `Instrument currency ${args.instrument.currency} differs from account currency ${args.accountCurrency}`
      : null;

  return {
    broker: "T212_INVEST",
    environment: args.environment,
    selectedInstrument: args.instrument
      ? {
          ticker: args.instrument.ticker,
          name: args.instrument.name,
          currency: args.instrument.currency
        }
      : null,
    side: args.translation.side,
    quantity: args.translation.quantity,
    orderValue: args.translation.orderValue,
    estimatedPrice: null,
    accountCurrency: args.accountCurrency,
    fxConversionWarning: fxWarning,
    decisionId: args.decision.decisionId,
    confidence: confidenceOf(args.decision),
    riskGates: args.translation.riskGates,
    rejectionReason: args.translation.rejectionReason,
    status: args.translation.status,
    disclaimer: T212_PROXY_DISCLAIMER
  };
}

export function buildProposal(args: {
  proposalId: string;
  userId: string;
  decision: GoldMetaDecisionInput;
  translation: T212TranslationResult;
  environment: T212Environment;
  instrument: T212SelectedInstrument;
  accountCurrency: string | null;
  estimatedPrice: number | null;
  createdAt: string;
  expiresAt: string;
}): T212ExecutionProposal {
  const idempotencyKey = buildIdempotencyKey({
    userId: args.userId,
    decisionId: args.decision.decisionId,
    instrumentId: args.instrument.instrumentId,
    action: args.translation.action,
    environment: args.environment
  });

  return {
    proposalId: args.proposalId,
    userId: args.userId,
    decisionId: args.decision.decisionId,
    broker: "T212_INVEST",
    environment: args.environment,
    instrumentId: args.instrument.instrumentId,
    instrumentTicker: args.instrument.ticker,
    instrumentName: args.instrument.name,
    action: args.translation.action,
    side: args.translation.side,
    quantity: args.translation.quantity,
    orderValue: args.translation.orderValue,
    estimatedPrice: args.estimatedPrice,
    accountCurrency: args.accountCurrency,
    fxConversionWarning:
      args.accountCurrency && args.instrument.currency !== args.accountCurrency
        ? `Instrument currency ${args.instrument.currency} differs from account currency ${args.accountCurrency}`
        : null,
    confidence: confidenceOf(args.decision),
    goldMetaDecision: String(args.decision.decision),
    reasonCodes: args.translation.reasonCodes,
    rejectionReason: args.translation.rejectionReason,
    idempotencyKey,
    status:
      args.translation.status === "SUBMISSION_DISABLED"
        ? "AWAITING_CONFIRMATION"
        : args.translation.status,
    riskEvaluation: args.translation.riskEvaluation,
    createdAt: args.createdAt,
    expiresAt: args.expiresAt,
    updatedAt: args.createdAt
  };
}
