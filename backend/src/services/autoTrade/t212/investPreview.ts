/**
 * Stock/ETF analysis preview for Trading 212 General Invest.
 * Separate from XAUUSD CFD scoring. Paper only — no broker orders.
 */

import { T212_PAPER_DISCLAIMER } from "./investPaperPortfolio";

export type T212StockPreviewAction = "BUY" | "HOLD" | "SELL_OWNED";

export type T212StockPreviewInput = {
  ticker: string;
  name?: string;
  currentPrice: number;
  currency?: string;
  ownedQuantity?: number;
  averagePurchasePrice?: number | null;
  proposedInvestmentAmount?: number;
  marketOpen?: boolean;
  priceTimestamp?: string;
  signalScore?: number | null;
  earningsWarning?: boolean;
  companyNewsWarning?: boolean;
  fxWarning?: boolean;
  duplicateSignal?: boolean;
};

export type T212StockPreview = {
  ticker: string;
  name: string;
  action: T212StockPreviewAction;
  confidence: number;
  currentPrice: number;
  proposedEntry: number | null;
  proposedInvestmentAmount: number | null;
  estimatedQuantity: number | null;
  riskLimit: number;
  marketStatus: "OPEN" | "CLOSED" | "UNKNOWN";
  dataTimestamp: string;
  reasons: string[];
  limitations: string[];
  ownedQuantity: number;
  disclaimer: typeof T212_PAPER_DISCLAIMER;
  ordersEnabled: false;
  autoTrade: "OFF";
};

const DEFAULT_RISK_LIMIT = 1_000;

/**
 * Conservative heuristic preview — not a promise of profit.
 * SELL_OWNED only when a position is already held.
 */
export function buildT212StockPreview(input: T212StockPreviewInput): T212StockPreview {
  const owned = Math.max(0, input.ownedQuantity ?? 0);
  const price = input.currentPrice;
  const score = input.signalScore;
  const reasons: string[] = [];
  const limitations: string[] = [
    "Paper preview only — confidence is not certainty.",
    "Does not use XAUUSD CFD scoring thresholds.",
    "No Trading 212 order will be submitted.",
    "AutoTrade remains OFF."
  ];

  let action: T212StockPreviewAction = "HOLD";
  let confidence = 0.35;

  if (input.duplicateSignal) {
    action = "HOLD";
    confidence = 0.2;
    reasons.push("Duplicate signal protection — waiting for a fresh unique signal.");
  } else if (input.marketOpen === false) {
    action = "HOLD";
    confidence = 0.15;
    reasons.push("Market appears closed — new paper entries are rejected.");
  } else if (typeof score === "number" && score >= 70 && owned === 0) {
    action = "BUY";
    confidence = Math.min(0.85, score / 100);
    reasons.push("Positive stock/ETF signal score supports a paper BUY preview.");
  } else if (typeof score === "number" && score <= 35 && owned > 0) {
    action = "SELL_OWNED";
    confidence = Math.min(0.8, (100 - score) / 100);
    reasons.push("Weak signal while holding — paper SELL OWNED preview only.");
  } else if (owned > 0) {
    action = "HOLD";
    confidence = 0.45;
    reasons.push("Existing position — hold unless risk or signal clearly deteriorates.");
  } else {
    action = "HOLD";
    confidence = 0.4;
    reasons.push("No clear BUY edge for an unowned instrument.");
  }

  if (input.earningsWarning) {
    limitations.push("Earnings warning — size and timing risk are elevated.");
    confidence = Math.max(0.1, confidence - 0.1);
  }
  if (input.companyNewsWarning) {
    limitations.push("Company-news warning — verify headline risk before acting.");
    confidence = Math.max(0.1, confidence - 0.08);
  }
  if (input.fxWarning) {
    limitations.push("Currency/FX warning — simulated FX costs apply in paper mode.");
  }
  if (action === "SELL_OWNED" && owned <= 0) {
    action = "HOLD";
    reasons.push("SELL OWNED blocked — no owned quantity (short selling unsupported).");
  }

  const invest =
    action === "BUY"
      ? Math.min(DEFAULT_RISK_LIMIT, Math.max(0, input.proposedInvestmentAmount ?? 250))
      : null;
  const qty =
    action === "BUY" && invest && price > 0
      ? Number((invest / price).toFixed(4))
      : action === "SELL_OWNED"
        ? owned
        : null;

  return {
    ticker: input.ticker,
    name: input.name ?? input.ticker,
    action,
    confidence: Number(confidence.toFixed(2)),
    currentPrice: price,
    proposedEntry: action === "HOLD" ? null : price,
    proposedInvestmentAmount: invest,
    estimatedQuantity: qty,
    riskLimit: DEFAULT_RISK_LIMIT,
    marketStatus:
      input.marketOpen === true ? "OPEN" : input.marketOpen === false ? "CLOSED" : "UNKNOWN",
    dataTimestamp: input.priceTimestamp ?? new Date().toISOString(),
    reasons,
    limitations,
    ownedQuantity: owned,
    disclaimer: T212_PAPER_DISCLAIMER,
    ordersEnabled: false,
    autoTrade: "OFF"
  };
}
