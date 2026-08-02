export const BACKEND_VERSION = "1.4.0-v5-intelligence";
export const RULE_CONFIG_VERSION = "rules-1.1.0";

export const decisionConfig = {
  version: RULE_CONFIG_VERSION,
  thresholds: {
    buy: 70,
    sell: -70,
    minRiskRewardToTp2: 1.5,
    minConfidenceForTrade: 45,
    staleAfterMs: 5 * 60 * 1000
  },
  scoringWeights: {
    trendDirection: 28,
    trendComponent: 18,
    confirmationCandle: 14,
    rejectionConfirmation: 8,
    breakoutRetest: 8,
    pocPosition: 10,
    valueAreaPosition: 8,
    levelInteraction: 6,
    valueMigration: 8,
    acceptance: 6,
    multiTimeframeAgreement: 10,
    conflictingEvidence: 12
  },
  guards: {
    provisionalAllowed: false,
    safetyLock: false
  },
  /**
   * Max relative divergence between alert close, OHLC, POC/VAH/VAL, and optional broker mid.
   * 0.02 = 2%. Blocks BUY/SELL when exceeded (e.g. 2408 fixture vs 4045 live).
   */
  priceConsistencyTolerance: 0.02,
  decisionTtlMs: 15 * 60 * 1000
} as const;
