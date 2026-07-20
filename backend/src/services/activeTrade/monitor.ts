import type { DecisionRecord } from "../../models/types";

export interface ActiveTradeMonitorResult {
  invalidated: boolean;
  reasons: string[];
}

export const monitorActiveTrade = (decision: DecisionRecord): ActiveTradeMonitorResult => {
  if (decision.decision === "WAIT") {
    return {
      invalidated: false,
      reasons: []
    };
  }

  return {
    invalidated: decision.lifecycleState === "INVALIDATED",
    reasons: decision.lifecycleState === "INVALIDATED" ? decision.reasonCodes : []
  };
};
