/**
 * Volatility-aware stop distance classification.
 * Does not auto-widen stops — only labels Too tight / Acceptable / Wide.
 */

export type StopDistanceClass = "TOO_TIGHT" | "ACCEPTABLE" | "WIDE";

export type StopDistanceValidation = {
  class: StopDistanceClass;
  stopDistance: number | null;
  atrMultiple: number | null;
  reasonCodes: string[];
  /** Hard-block READY when true (too tight vs policy). */
  blocksReady: boolean;
  message: string;
};

export type StopDistancePolicy = {
  minStopPoints: number;
  minAtrMultiple: number;
  wideAtrMultiple: number;
  spreadBufferPoints: number;
};

export const DEFAULT_STOP_DISTANCE_POLICY: StopDistancePolicy = {
  minStopPoints: 1.5,
  minAtrMultiple: 0.35,
  wideAtrMultiple: 2.5,
  spreadBufferPoints: 0.3
};

export const validateStopDistance = (input: {
  entry: number | null | undefined;
  stop: number | null | undefined;
  atr?: number | null;
  recentRange?: number | null;
  spreadPoints?: number | null;
  policy?: StopDistancePolicy;
}): StopDistanceValidation => {
  const policy = input.policy ?? DEFAULT_STOP_DISTANCE_POLICY;
  const entry = input.entry;
  const stop = input.stop;
  if (entry == null || stop == null || !Number.isFinite(entry) || !Number.isFinite(stop)) {
    return {
      class: "ACCEPTABLE",
      stopDistance: null,
      atrMultiple: null,
      reasonCodes: [],
      blocksReady: false,
      message: "Stop distance not evaluated."
    };
  }

  const stopDistance = Math.abs(entry - stop);
  const atr = input.atr != null && input.atr > 0 ? input.atr : null;
  const range = input.recentRange != null && input.recentRange > 0 ? input.recentRange : null;
  const spread = input.spreadPoints != null && input.spreadPoints > 0 ? input.spreadPoints : 0;
  const atrMultiple = atr != null ? stopDistance / atr : null;
  const reasons: string[] = [];

  const minNeeded = Math.max(
    policy.minStopPoints,
    spread + policy.spreadBufferPoints,
    atr != null ? atr * policy.minAtrMultiple : 0,
    range != null ? range * 0.25 : 0
  );

  if (stopDistance + 1e-9 < minNeeded) {
    reasons.push("STOP_TOO_TIGHT");
    return {
      class: "TOO_TIGHT",
      stopDistance,
      atrMultiple,
      reasonCodes: reasons,
      blocksReady: true,
      message: "Stop is too tight for current volatility and spread."
    };
  }

  if (atrMultiple != null && atrMultiple >= policy.wideAtrMultiple) {
    reasons.push("STOP_WIDE");
    return {
      class: "WIDE",
      stopDistance,
      atrMultiple,
      reasonCodes: reasons,
      blocksReady: false,
      message: "Stop is wide relative to ATR — size risk carefully."
    };
  }

  return {
    class: "ACCEPTABLE",
    stopDistance,
    atrMultiple,
    reasonCodes: [],
    blocksReady: false,
    message: "Stop distance is acceptable."
  };
};
