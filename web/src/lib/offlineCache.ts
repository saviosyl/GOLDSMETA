const DECISION_KEY = "goldmeta.cache.latestDecision";
const SETTINGS_KEY = "goldmeta.cache.settings";
const HISTORY_KEY = "goldmeta.cache.history";

export interface CachedEnvelope<T> {
  savedAt: string;
  value: T;
}

export const saveCache = <T>(key: string, value: T): void => {
  try {
    const envelope: CachedEnvelope<T> = { savedAt: new Date().toISOString(), value };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Quota / private mode — ignore
  }
};

export const loadCache = <T>(key: string): CachedEnvelope<T> | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedEnvelope<T>;
  } catch {
    return null;
  }
};

export const cacheKeys = {
  decision: DECISION_KEY,
  settings: SETTINGS_KEY,
  history: HISTORY_KEY
} as const;

export const clearUserCaches = (): void => {
  for (const key of Object.values(cacheKeys)) {
    localStorage.removeItem(key);
  }
};
