export const nowIso = (): string => new Date().toISOString();

export const addMsIso = (isoDate: string, ms: number): string =>
  new Date(new Date(isoDate).getTime() + ms).toISOString();

export const isWithinSkew = (isoDate: string, skewMs: number, now = Date.now()): boolean => {
  const timestamp = new Date(isoDate).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return Math.abs(now - timestamp) <= skewMs;
};

/**
 * Validate TradingView `sentAt` (alert generation / send time).
 *
 * Asymmetric windows:
 * - past: TradingView may retry/delay webhook delivery several minutes after
 *   Pine sets `sentAt = timenow` at bar close (observed up to ~26 minutes).
 * - future: tight bound for clock skew only.
 *
 * Does not validate `barTime` — candle time may legitimately be older.
 */
export const isSentAtAcceptable = (
  isoDate: string,
  options: { maxPastMs: number; maxFutureMs: number },
  now = Date.now()
): boolean => {
  const timestamp = new Date(isoDate).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const ageMs = now - timestamp;
  if (ageMs < -options.maxFutureMs) {
    return false;
  }
  if (ageMs > options.maxPastMs) {
    return false;
  }
  return true;
};

export const hoursSinceEpoch = (date = new Date()): number =>
  Math.floor(date.getTime() / (60 * 60 * 1000));
