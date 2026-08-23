import type { BrokerAction } from "../../models/trading";
import type {
  BrokerAdapter,
  BrokerCapabilities,
  BrokerOrderRequest,
  BrokerOrderResult
} from "./types";
import { EMPTY_CAPABILITIES } from "./types";

/**
 * Trading 212 Public API does not support XAUUSD CFD automation.
 * This adapter only produces human-executable instructions.
 */
export class Trading212ManualAdapter implements BrokerAdapter {
  readonly id = "trading212_manual" as const;
  readonly displayName = "Trading 212 (manual)";

  capabilities(): BrokerCapabilities {
    return {
      ...EMPTY_CAPABILITIES,
      supportsXauusdCfd: false,
      automatedSubmission: false
    };
  }

  supports(_action: BrokerAction): boolean {
    return false;
  }

  placeEntry(request: BrokerOrderRequest): Promise<BrokerOrderResult> {
    const instructions = [
      "Trading 212 Public API does not support XAUUSD CFD order submission.",
      `Open Trading 212 manually and consider a ${request.side} on XAUUSD.`,
      request.entryPrice != null
        ? `Suggested entry: ${request.entryPrice.toFixed(2)} (${request.orderType}).`
        : `Suggested entry: ${request.orderType} at market discretion.`,
      request.stopLoss != null
        ? `Suggested stop loss: ${request.stopLoss.toFixed(2)}.`
        : "Define a stop loss before entry.",
      ...request.takeProfits.map(
        (tp) => `Suggested ${tp.label}: ${tp.price.toFixed(2)} (close ~${Math.round(tp.closeFraction * 100)}%).`
      ),
      "GoldMeta does not guarantee profits. You remain responsible for every trade."
    ];

    return Promise.resolve({
      accepted: false,
      status: "MANUAL_ONLY",
      message: "Manual execution only — Trading 212 API cannot place XAUUSD CFD orders.",
      instructions
    });
  }

  cancelPendingOrders(): Promise<{ cancelled: number; message: string }> {
    return Promise.resolve({
      cancelled: 0,
      message:
        "No automated Trading 212 CFD orders to cancel. Cancel any pending orders manually in the broker app if needed."
    });
  }
}
