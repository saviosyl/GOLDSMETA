export const BACKEND_VERSION = "1.0.0-mvp";
export const RULE_CONFIG_VERSION = "rules-1.0.0";

export const decisionConfig = {
  version: RULE_CONFIG_VERSION,
  thresholds: {
    buy: 70,
    sell: -70,
    minRiskRewardToTp2: 1.5,
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
  decisionTtlMs: 15 * 60 * 1000
} as const;
