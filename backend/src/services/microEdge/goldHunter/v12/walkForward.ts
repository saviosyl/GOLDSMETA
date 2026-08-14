/**
 * Rolling chronological walk-forward folds — no shuffle, past train / future val.
 */
export type WalkForwardFold<T extends { timestampMs: number }> = {
  foldIndex: number;
  train: T[];
  validation: T[];
  trainRange: { fromMs: number; toMs: number };
  validationRange: { fromMs: number; toMs: number };
};

export type WalkForwardPlan<T extends { timestampMs: number }> = {
  folds: WalkForwardFold<T>[];
  holdout: T[];
  holdoutRange: { fromMs: number; toMs: number } | null;
  purgedCount: number;
};

function rangeOf<T extends { timestampMs: number }>(
  rows: T[]
): { fromMs: number; toMs: number } | null {
  if (!rows.length) return null;
  return {
    fromMs: rows[0]!.timestampMs,
    toMs: rows[rows.length - 1]!.timestampMs
  };
}

/**
 * Reserve final holdoutFrac (time-based) from the start, then build rolling folds
 * with trainDays / valDays on the remaining chronological series.
 */
export function buildWalkForwardFolds<T extends { timestampMs: number }>(
  rowsSorted: T[],
  opts?: {
    trainDayMs?: number;
    valDayMs?: number;
    stepDayMs?: number;
    holdoutFrac?: number;
    purgeMs?: number;
    minFolds?: number;
  }
): WalkForwardPlan<T> {
  const trainDayMs = opts?.trainDayMs ?? 14 * 86_400_000;
  const valDayMs = opts?.valDayMs ?? 4 * 86_400_000;
  const stepDayMs = opts?.stepDayMs ?? valDayMs;
  const holdoutFrac = opts?.holdoutFrac ?? 0.2;
  const purgeMs = opts?.purgeMs ?? 60_000;
  const minFolds = opts?.minFolds ?? 5;

  if (!rowsSorted.length) {
    return { folds: [], holdout: [], holdoutRange: null, purgedCount: 0 };
  }

  const t0 = rowsSorted[0]!.timestampMs;
  const t1 = rowsSorted[rowsSorted.length - 1]!.timestampMs;
  const span = t1 - t0;
  const holdoutStart = t0 + span * (1 - holdoutFrac);

  const research = rowsSorted.filter((r) => r.timestampMs < holdoutStart);
  const holdoutRaw = rowsSorted.filter((r) => r.timestampMs >= holdoutStart);
  let purgedCount = 0;
  let holdout = holdoutRaw;
  if (research.length && holdout.length) {
    const researchEnd = research[research.length - 1]!.timestampMs;
    const before = holdout.length;
    holdout = holdout.filter((r) => r.timestampMs >= researchEnd + purgeMs);
    purgedCount += before - holdout.length;
  }

  const folds: WalkForwardFold<T>[] = [];
  if (!research.length) {
    return {
      folds,
      holdout,
      holdoutRange: rangeOf(holdout),
      purgedCount
    };
  }

  const researchStart = research[0]!.timestampMs;
  const researchEnd = research[research.length - 1]!.timestampMs;
  let foldStart = researchStart;
  let foldIndex = 0;

  while (foldStart + trainDayMs + valDayMs <= researchEnd + 1) {
    const trainFrom = foldStart;
    const trainTo = foldStart + trainDayMs;
    const valFrom = trainTo + purgeMs;
    const valTo = trainTo + valDayMs;

    const train = research.filter(
      (r) => r.timestampMs >= trainFrom && r.timestampMs < trainTo
    );
    const validation = research.filter(
      (r) => r.timestampMs >= valFrom && r.timestampMs < valTo
    );

    if (train.length >= 500 && validation.length >= 100) {
      folds.push({
        foldIndex,
        train,
        validation,
        trainRange: { fromMs: trainFrom, toMs: trainTo - 1 },
        validationRange: { fromMs: valFrom, toMs: Math.min(valTo - 1, researchEnd) }
      });
      foldIndex += 1;
    }
    foldStart += stepDayMs;
  }

  // If too few folds, shrink train/val proportionally once.
  if (folds.length < minFolds && research.length > 1000) {
    const altTrain = Math.max(7 * 86_400_000, Math.floor(span * 0.35));
    const altVal = Math.max(2 * 86_400_000, Math.floor(span * 0.08));
    if (altTrain !== trainDayMs || altVal !== valDayMs) {
      return buildWalkForwardFolds(rowsSorted, {
        ...opts,
        trainDayMs: altTrain,
        valDayMs: altVal,
        stepDayMs: altVal,
        minFolds: 1
      });
    }
  }

  return {
    folds,
    holdout,
    holdoutRange: rangeOf(holdout),
    purgedCount
  };
}

/** Assert fold chronology: train entirely before validation. */
export function assertFoldChronology<T extends { timestampMs: number }>(
  fold: WalkForwardFold<T>
): boolean {
  if (!fold.train.length || !fold.validation.length) return false;
  const trainEnd = fold.train[fold.train.length - 1]!.timestampMs;
  const valStart = fold.validation[0]!.timestampMs;
  return trainEnd < valStart;
}
