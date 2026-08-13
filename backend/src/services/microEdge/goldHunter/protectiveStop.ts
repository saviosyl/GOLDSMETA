/**
 * TRAIN-derived protective stop candidates; VALIDATION selects among them.
 * Holdout must never influence stop selection.
 */
import { GH_DEFAULT_PROTECTIVE_STOP } from "./config";

/**
 * Candidate stops from TRAIN mid absolute returns (short-horizon volatility proxy).
 * Quantiles of |ret5| * mid in price units, plus default.
 */
export function deriveProtectiveStopCandidatesFromTrain(args: {
  trainMids: number[];
  /** Absolute 5-second mid moves in price units (TRAIN only). */
  absMoves5: number[];
}): number[] {
  const moves = [...args.absMoves5].filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!moves.length) {
    return [0.25, 0.4, GH_DEFAULT_PROTECTIVE_STOP, 0.9].sort((a, b) => a - b);
  }
  const q = (p: number) => {
    const i = Math.min(moves.length - 1, Math.max(0, Math.floor(p * (moves.length - 1))));
    return moves[i]!;
  };
  const raw = [q(0.5), q(0.75), q(0.9), q(0.95), GH_DEFAULT_PROTECTIVE_STOP];
  // Bound stops to a sane scalping range for XAUUSD.
  const bounded = raw
    .map((x) => Math.min(2.5, Math.max(0.12, Number(x.toFixed(3)))))
    .filter((x, i, a) => a.indexOf(x) === i)
    .sort((a, b) => a - b);
  return bounded;
}

export type StopSelectionReport = {
  candidates: number[];
  selected: number;
  derivation: string;
  validationByStop: Array<{
    stop: number;
    tradeCount: number;
    expectancy: number;
    netPnl: number;
    maxDrawdown: number;
    eligible: boolean;
  }>;
};
