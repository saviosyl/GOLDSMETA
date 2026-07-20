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

export const hoursSinceEpoch = (date = new Date()): number =>
  Math.floor(date.getTime() / (60 * 60 * 1000));
