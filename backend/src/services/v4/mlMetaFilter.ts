/**
 * ML meta-filter — accepts/rejects deterministic candidates only.
 * Never generates BUY/SELL/entries/stops/targets.
 * Default: DISABLED / ABSTAIN until calibrated walk-forward model exists.
 */
export type MlMetaDecision = "ACCEPT" | "REJECT" | "ABSTAIN" | "DISABLED";

export interface MlMetaFeatures {
  /** Features must exist at signal time only — no leakage. */
  qualityScore: number;
  netRrTp2: number | null;
  atrPercentile: number | null;
  session: string;
  regime: string;
  strategyFamily: string;
  direction: "BUY" | "SELL";
  spreadCostR: number | null;
  confirmationBars: number;
  gcConfirmed: boolean;
}

export interface MlMetaModelCard {
  modelId: string;
  algorithm: "logistic_regression_baseline" | "gbdt_challenger" | "none";
  trainedOn: string | null;
  calibration: "none" | "platt" | "isotonic";
  status: "UNTRAINED" | "VALIDATION_ONLY" | "SHADOW" | "PRODUCTION_ABSTAIN";
}

export const defaultMlModelCard: MlMetaModelCard = {
  modelId: "v4-ml-meta-untrained",
  algorithm: "none",
  trainedOn: null,
  calibration: "none",
  status: "UNTRAINED"
};

export function mlMetaFilter(
  enabled: boolean,
  _features: MlMetaFeatures
): { decision: MlMetaDecision; model: MlMetaModelCard; reason: string } {
  if (!enabled) {
    return {
      decision: "DISABLED",
      model: defaultMlModelCard,
      reason: "ML meta-filter disabled — deterministic gates only"
    };
  }
  // Until walk-forward calibration exists, always abstain (fail closed for ML path).
  return {
    decision: "ABSTAIN",
    model: { ...defaultMlModelCard, status: "PRODUCTION_ABSTAIN" },
    reason: "No calibrated model — abstain (cannot override failed gates; cannot create direction)"
  };
}
