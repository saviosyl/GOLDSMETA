import { ApiError } from "../types/models";

const NETWORK_ERROR_PATTERN = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;

/** Friendly message for UI banners; keeps ApiError codes when present. */
export const formatClientError = (err: unknown, fallback: string): string => {
  if (err instanceof ApiError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof TypeError || (err instanceof Error && NETWORK_ERROR_PATTERN.test(err.message))) {
    return "Could not reach the GoldMeta API from this browser. Check your connection and try again.";
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return fallback;
};
