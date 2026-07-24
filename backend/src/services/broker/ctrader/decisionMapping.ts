/**
 * Direct CFD decision mapping — GoldMeta XAUUSD ↔ cTrader XAUUSD.
 */

import type { OppositeSignalPolicy, TradeAction } from "../domain";

export type PositionSide = "LONG" | "SHORT" | "FLAT";

export interface MappedBrokerAction {
  action: TradeAction;
  brokerMutation: "OPEN_LONG" | "OPEN_SHORT" | "CLOSE_LONG" | "CLOSE_SHORT" | "NONE";
  allowed: boolean;
  reason: string;
}

export function mapDecisionToCTraderAction(args: {
  decision: string;
  position: PositionSide;
  oppositePolicy?: OppositeSignalPolicy;
}): MappedBrokerAction {
  const d = String(args.decision ?? "WAIT").toUpperCase();
  const policy = args.oppositePolicy ?? "CLOSE_ONLY";

  if (d === "WAIT") {
    return {
      action: "WAIT",
      brokerMutation: "NONE",
      allowed: true,
      reason: "WAIT — no broker mutation."
    };
  }

  if (d === "BUY") {
    if (args.position === "FLAT") {
      return {
        action: "BUY",
        brokerMutation: "OPEN_LONG",
        allowed: true,
        reason: "Open XAUUSD long when flat."
      };
    }
    if (args.position === "LONG") {
      return {
        action: "WAIT",
        brokerMutation: "NONE",
        allowed: false,
        reason: "Already long — no averaging / pyramiding."
      };
    }
    // short + BUY
    if (policy === "CLOSE_ONLY") {
      return {
        action: "EXIT_SHORT",
        brokerMutation: "CLOSE_SHORT",
        allowed: true,
        reason: "CLOSE_ONLY — close short; do not reverse."
      };
    }
    if (policy === "IGNORE_UNTIL_FLAT") {
      return {
        action: "WAIT",
        brokerMutation: "NONE",
        allowed: false,
        reason: "IGNORE_UNTIL_FLAT while short."
      };
    }
    return {
      action: "EXIT_SHORT",
      brokerMutation: "CLOSE_SHORT",
      allowed: true,
      reason: "CLOSE_AND_REVERSE deferred — initial version closes only."
    };
  }

  if (d === "SELL") {
    if (args.position === "FLAT") {
      return {
        action: "SELL",
        brokerMutation: "OPEN_SHORT",
        allowed: true,
        reason: "Open XAUUSD short when flat."
      };
    }
    if (args.position === "SHORT") {
      return {
        action: "WAIT",
        brokerMutation: "NONE",
        allowed: false,
        reason: "Already short — no averaging / pyramiding."
      };
    }
    if (policy === "CLOSE_ONLY") {
      return {
        action: "EXIT_LONG",
        brokerMutation: "CLOSE_LONG",
        allowed: true,
        reason: "CLOSE_ONLY — close long; do not reverse."
      };
    }
    if (policy === "IGNORE_UNTIL_FLAT") {
      return {
        action: "WAIT",
        brokerMutation: "NONE",
        allowed: false,
        reason: "IGNORE_UNTIL_FLAT while long."
      };
    }
    return {
      action: "EXIT_LONG",
      brokerMutation: "CLOSE_LONG",
      allowed: true,
      reason: "CLOSE_AND_REVERSE deferred — initial version closes only."
    };
  }

  if (d === "EXIT_LONG" || d === "EXIT") {
    if (args.position === "LONG") {
      return {
        action: "EXIT_LONG",
        brokerMutation: "CLOSE_LONG",
        allowed: true,
        reason: "Close long position."
      };
    }
    return {
      action: "WAIT",
      brokerMutation: "NONE",
      allowed: false,
      reason: "No long position to exit."
    };
  }

  if (d === "EXIT_SHORT") {
    if (args.position === "SHORT") {
      return {
        action: "EXIT_SHORT",
        brokerMutation: "CLOSE_SHORT",
        allowed: true,
        reason: "Close short position."
      };
    }
    return {
      action: "WAIT",
      brokerMutation: "NONE",
      allowed: false,
      reason: "No short position to exit."
    };
  }

  return {
    action: "WAIT",
    brokerMutation: "NONE",
    allowed: false,
    reason: `Unsupported decision ${d}`
  };
}
