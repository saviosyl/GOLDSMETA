/**
 * Forming-opportunity candidate lifecycle — stable candidate_id across stages.
 */

export type FormingState =
  | "IDLE"
  | "WATCHING"
  | "PREPARE"
  | "CONFIRMATION_PENDING"
  | "READY"
  | "INVALIDATED"
  | "EXPIRED"
  | "BLOCKED";

export type FormingCandidate = {
  candidateId: string;
  direction: "BUY" | "SELL";
  trigger: number | null;
  entryZone: string | null;
  invalidation: number | null;
  possibleTp1: number | null;
  conditionsCompleted: number;
  conditionsRequired: number;
  createdAt: string;
  expiresAt: string;
  currentState: FormingState;
  planSourceKey: string | null;
};

export const buildCandidateId = (
  symbol: string,
  direction: "BUY" | "SELL",
  planSourceKey: string | null,
  trigger: number | null
): string => {
  const key = planSourceKey || `${symbol}|${direction}|${trigger ?? "na"}`;
  return `cand_${key.replace(/[^A-Za-z0-9_|.-]/g, "_")}`;
};

export const deriveFormingState = (input: {
  hasDirection: boolean;
  approachingTrigger: boolean;
  hasLevels: boolean;
  confirmationPending: boolean;
  confirmationPassed: boolean;
  hardBlocked: boolean;
  invalidated: boolean;
  expired: boolean;
}): FormingState => {
  if (input.invalidated) return "INVALIDATED";
  if (input.expired) return "EXPIRED";
  if (input.hardBlocked && input.hasLevels) return "BLOCKED";
  if (input.hardBlocked && !input.hasDirection) return "IDLE";
  if (input.confirmationPassed && input.hasLevels && !input.hardBlocked) return "READY";
  if (input.hasLevels && input.confirmationPending) return "CONFIRMATION_PENDING";
  if (input.hasLevels) return "PREPARE";
  if (input.approachingTrigger || input.hasDirection) return "WATCHING";
  return "IDLE";
};

/** Deduplicate alerts by candidate + state + trigger + window. */
export const alertDedupeKey = (
  candidateId: string,
  state: FormingState,
  trigger: number | null,
  windowKey: string | null
): string => `${candidateId}|${state}|${trigger ?? "na"}|${windowKey ?? "na"}`;
