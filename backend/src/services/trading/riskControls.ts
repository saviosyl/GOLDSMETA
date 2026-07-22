import type { ProposeOrderRequest, RiskControls, TradingControls } from "../../models/trading";

export type RiskBlockCode =
  | "EMERGENCY_STOP"
  | "MODE_BLOCKS_SUBMISSION"
  | "LIVE_LOCKED"
  | "LIVE_NOT_ENABLED"
  | "MAX_RISK"
  | "MAX_DAILY_LOSS"
  | "MAX_TRADES"
  | "MIN_CONFIDENCE"
  | "MAX_SPREAD"
  | "SLIPPAGE"
  | "STALE_DATA"
  | "DUPLICATE_SIGNAL"
  | "HIGH_IMPACT_NEWS"
  | "CONFIRMATION_REQUIRED"
  | "BROKER_UNSUPPORTED";

export interface RiskEvaluationContext {
  controls: TradingControls;
  request: ProposeOrderRequest;
  tradesToday: number;
  realizedDailyLossPercent: number;
  seenSignalKeys: Set<string>;
  /** When true, CONFIRM mode may create a proposal even though execution is gated. */
  allowConfirmProposal?: boolean;
}

export interface RiskEvaluationResult {
  allowed: boolean;
  blocks: Array<{ code: RiskBlockCode; message: string }>;
}

/** Hard product policy — these strategies cannot be enabled anywhere. */
export const FORBIDDEN_RECOVERY_STRATEGIES = [
  "martingale",
  "grid recovery",
  "averaging down to recover losses"
] as const;

export const mergeRiskControls = (
  current: RiskControls,
  patch: Partial<RiskControls>
): RiskControls => ({ ...current, ...patch });

/**
 * Evaluates whether an order may be submitted/executed.
 * For CONFIRM proposal creation, pass allowConfirmProposal=true so mode doesn't block drafting.
 */
export const evaluateSubmissionGuards = (ctx: RiskEvaluationContext): RiskEvaluationResult => {
  const blocks: RiskEvaluationResult["blocks"] = [];
  const { controls, request } = ctx;
  const risk = controls.riskControls;

  if (controls.emergencyStopActive) {
    blocks.push({
      code: "EMERGENCY_STOP",
      message: "Emergency Stop Auto Trading is active. New orders are blocked."
    });
  }

  if (controls.mode === "MANUAL") {
    blocks.push({
      code: "MODE_BLOCKS_SUBMISSION",
      message: "Manual mode provides analysis and instructions only — no order submission."
    });
  }

  if (controls.mode === "CONFIRM" && !ctx.allowConfirmProposal) {
    if (!request.confirmationToken) {
      blocks.push({
        code: "CONFIRMATION_REQUIRED",
        message: "Confirm mode requires Face ID or explicit confirmation before submission."
      });
    }
  }

  if (controls.mode === "LIVE_AUTO") {
    if (!controls.liveAutoUnlocked) {
      blocks.push({
        code: "LIVE_LOCKED",
        message: "Live Auto is locked until demo-testing requirements are completed."
      });
    } else if (!controls.liveAutoEnabledByUser || !controls.autoTradingEnabled) {
      blocks.push({
        code: "LIVE_NOT_ENABLED",
        message: "Live Auto must be manually enabled after unlock."
      });
    }
  }

  if (controls.mode === "DEMO_AUTO" && !controls.autoTradingEnabled && !ctx.allowConfirmProposal) {
    blocks.push({
      code: "MODE_BLOCKS_SUBMISSION",
      message: "Demo Auto is paused. Enable auto trading to simulate orders."
    });
  }

  if (request.riskPercent > risk.maxRiskPerTradePercent) {
    blocks.push({
      code: "MAX_RISK",
      message: `Risk per trade ${request.riskPercent}% exceeds max ${risk.maxRiskPerTradePercent}%.`
    });
  }

  if (ctx.realizedDailyLossPercent >= risk.maxDailyLossPercent) {
    blocks.push({
      code: "MAX_DAILY_LOSS",
      message: `Daily loss ${ctx.realizedDailyLossPercent.toFixed(2)}% reached max ${risk.maxDailyLossPercent}%.`
    });
  }

  if (ctx.tradesToday >= risk.maxTradesPerDay) {
    blocks.push({
      code: "MAX_TRADES",
      message: `Trades today ${ctx.tradesToday} reached max ${risk.maxTradesPerDay}.`
    });
  }

  if (request.confidence < risk.minConfidence) {
    blocks.push({
      code: "MIN_CONFIDENCE",
      message: `Confidence ${request.confidence} is below minimum ${risk.minConfidence}.`
    });
  }

  if (request.spread != null && request.spread > risk.maxSpread) {
    blocks.push({
      code: "MAX_SPREAD",
      message: `Spread ${request.spread} exceeds max ${risk.maxSpread}.`
    });
  }

  if (
    request.expectedPrice != null &&
    request.fillPrice != null &&
    Math.abs(request.fillPrice - request.expectedPrice) > risk.slippageTolerance
  ) {
    blocks.push({
      code: "SLIPPAGE",
      message: `Slippage exceeds tolerance ${risk.slippageTolerance}.`
    });
  }

  if (risk.blockStaleData && (request.dataQuality === "STALE" || request.dataQuality === "INVALID")) {
    blocks.push({
      code: "STALE_DATA",
      message: "Stale or invalid market data blocks order submission."
    });
  }

  if (risk.blockDuplicateSignals && request.signalKey && ctx.seenSignalKeys.has(request.signalKey)) {
    blocks.push({
      code: "DUPLICATE_SIGNAL",
      message: "Duplicate signal key blocked."
    });
  }

  if (risk.blockHighImpactNews && request.highImpactNewsActive) {
    blocks.push({
      code: "HIGH_IMPACT_NEWS",
      message: "High-impact news window blocks new orders."
    });
  }

  return { allowed: blocks.length === 0, blocks };
};
