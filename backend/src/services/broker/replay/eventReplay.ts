/**
 * Broker event replay harness — never calls a real broker.
 * HYPOTHETICAL — NO BROKER ORDER
 */

import type { TradeIntentState } from "../domain";

export const REPLAY_LABEL = "HYPOTHETICAL — NO BROKER ORDER";

export type ReplayScenario =
  | "buy_fill"
  | "sell_fill"
  | "close_long"
  | "close_short"
  | "partial_fill"
  | "duplicate_event"
  | "out_of_order"
  | "timeout_later_fill"
  | "rejected"
  | "cancelled"
  | "disconnect"
  | "restart";

export interface ReplayStep {
  at: string;
  kind: string;
  nextState: TradeIntentState;
  note: string;
}

export function replayBrokerScenario(scenario: ReplayScenario): {
  label: typeof REPLAY_LABEL;
  scenario: ReplayScenario;
  steps: ReplayStep[];
  blocksNewOrders: boolean;
} {
  const now = new Date().toISOString();
  const base = { label: REPLAY_LABEL as typeof REPLAY_LABEL, scenario };
  switch (scenario) {
    case "buy_fill":
      return {
        ...base,
        blocksNewOrders: false,
        steps: [
          { at: now, kind: "SUBMITTING", nextState: "SUBMITTING", note: "dispatch" },
          { at: now, kind: "ACCEPTED", nextState: "ACCEPTED", note: "ack" },
          { at: now, kind: "FILLED", nextState: "FILLED", note: "fill" }
        ]
      };
    case "timeout_later_fill":
      return {
        ...base,
        blocksNewOrders: true,
        steps: [
          { at: now, kind: "SUBMITTING", nextState: "SUBMITTING", note: "dispatch" },
          { at: now, kind: "TIMEOUT", nextState: "UNKNOWN", note: "no ack" },
          { at: now, kind: "RECONCILE_FILL", nextState: "FILLED", note: "later fill" }
        ]
      };
    case "rejected":
      return {
        ...base,
        blocksNewOrders: false,
        steps: [
          { at: now, kind: "SUBMITTING", nextState: "SUBMITTING", note: "dispatch" },
          { at: now, kind: "REJECTED", nextState: "REJECTED", note: "broker reject" }
        ]
      };
    default:
      return {
        ...base,
        blocksNewOrders: scenario === "disconnect" || scenario === "restart",
        steps: [
          {
            at: now,
            kind: scenario.toUpperCase(),
            nextState: "UNKNOWN",
            note: "labelled hypothetical replay"
          }
        ]
      };
  }
}
