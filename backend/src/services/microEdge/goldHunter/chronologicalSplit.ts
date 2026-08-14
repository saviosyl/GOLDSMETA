/**
 * Chronological TRAIN / VALIDATION / HOLDOUT with purge/embargo.
 * NO random shuffle. Scaler fitted on TRAIN only (caller responsibility).
 */
import {
  GH_PURGE_MS,
  GH_TRAIN_FRACTION,
  GH_VALIDATION_FRACTION
} from "./config";

export type SplitPartition = "train" | "validation" | "holdout" | "purged";

export type ChronologicalSplit<T extends { timestampMs: number }> = {
  train: T[];
  validation: T[];
  holdout: T[];
  purgedCount: number;
  trainRange: { fromMs: number; toMs: number } | null;
  validationRange: { fromMs: number; toMs: number } | null;
  holdoutRange: { fromMs: number; toMs: number } | null;
};

function rangeOf<T extends { timestampMs: number }>(
  rows: T[]
): { fromMs: number; toMs: number } | null {
  if (rows.length === 0) return null;
  return {
    fromMs: rows[0]!.timestampMs,
    toMs: rows[rows.length - 1]!.timestampMs
  };
}

export function chronologicalSplit<T extends { timestampMs: number }>(
  rowsSorted: T[],
  opts?: {
    trainFrac?: number;
    validationFrac?: number;
    purgeMs?: number;
  }
): ChronologicalSplit<T> {
  const trainFrac = opts?.trainFrac ?? GH_TRAIN_FRACTION;
  const validationFrac = opts?.validationFrac ?? GH_VALIDATION_FRACTION;
  const purgeMs = opts?.purgeMs ?? GH_PURGE_MS;
  const n = rowsSorted.length;
  if (n === 0) {
    return {
      train: [],
      validation: [],
      holdout: [],
      purgedCount: 0,
      trainRange: null,
      validationRange: null,
      holdoutRange: null
    };
  }

  const trainEndIdx = Math.floor(n * trainFrac);
  const valEndIdx = Math.floor(n * (trainFrac + validationFrac));

  let train = rowsSorted.slice(0, trainEndIdx);
  let validation = rowsSorted.slice(trainEndIdx, valEndIdx);
  let holdout = rowsSorted.slice(valEndIdx);
  let purgedCount = 0;

  if (train.length && validation.length) {
    const trainEndTs = train[train.length - 1]!.timestampMs;
    const before = validation.length;
    validation = validation.filter((r) => r.timestampMs >= trainEndTs + purgeMs);
    purgedCount += before - validation.length;
  }
  if (validation.length && holdout.length) {
    const valEndTs = validation[validation.length - 1]!.timestampMs;
    const before = holdout.length;
    holdout = holdout.filter((r) => r.timestampMs >= valEndTs + purgeMs);
    purgedCount += before - holdout.length;
  } else if (train.length && holdout.length && validation.length === 0) {
    const trainEndTs = train[train.length - 1]!.timestampMs;
    const before = holdout.length;
    holdout = holdout.filter((r) => r.timestampMs >= trainEndTs + purgeMs);
    purgedCount += before - holdout.length;
  }

  return {
    train,
    validation,
    holdout,
    purgedCount,
    trainRange: rangeOf(train),
    validationRange: rangeOf(validation),
    holdoutRange: rangeOf(holdout)
  };
}
