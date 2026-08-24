import { randomUUID } from "crypto";
import type { BrokerAction } from "../../models/trading";
import type {
  BrokerAdapter,
  BrokerCapabilities,
  BrokerOrderRequest,
  BrokerOrderResult
} from "./types";

/** Simulated broker used exclusively by Demo Auto mode. */
export class DemoSimulatedAdapter implements BrokerAdapter {
  readonly id = "demo_simulated" as const;
  readonly displayName = "GoldMeta Demo Simulator";

  private pending = new Map<string, BrokerOrderRequest>();

  capabilities(): BrokerCapabilities {
    return {
      supportsXauusdCfd: true,
      entry: true,
      stopLoss: true,
      takeProfit: true,
      partialClose: true,
      moveBreakeven: true,
      earlyExit: true,
      cancelPending: true,
      automatedSubmission: true
    };
  }

  supports(action: BrokerAction): boolean {
    return this.capabilities()[capabilityKey(action)];
  }

  placeEntry(request: BrokerOrderRequest): Promise<BrokerOrderResult> {
    const brokerOrderId = `demo-${randomUUID()}`;
    this.pending.set(brokerOrderId, request);
    const fillPrice = request.entryPrice ?? 0;
    return Promise.resolve({
      accepted: true,
      brokerOrderId,
      status: "FILLED",
      fillPrice,
      message: "Demo order filled on simulated funds.",
      instructions: [
        "Simulated fill only — no real broker order was sent.",
        "Never increase size to recover losses. Martingale/grid/averaging-down remain disabled."
      ]
    });
  }

  cancelPendingOrders(): Promise<{ cancelled: number; message: string }> {
    const cancelled = this.pending.size;
    this.pending.clear();
    return Promise.resolve({
      cancelled,
      message: cancelled > 0 ? `Cancelled ${cancelled} simulated pending order(s).` : "No simulated pending orders."
    });
  }

  setStopLoss(brokerOrderId: string, price: number): Promise<BrokerOrderResult> {
    return Promise.resolve(this.manage(brokerOrderId, `Demo stop loss set to ${price.toFixed(2)}.`));
  }

  setTakeProfit(brokerOrderId: string, price: number, closeFraction: number): Promise<BrokerOrderResult> {
    return Promise.resolve(
      this.manage(
        brokerOrderId,
        `Demo take profit set to ${price.toFixed(2)} (close ${Math.round(closeFraction * 100)}%).`
      )
    );
  }

  partialClose(brokerOrderId: string, fraction: number): Promise<BrokerOrderResult> {
    return Promise.resolve(this.manage(brokerOrderId, `Demo partial close ${Math.round(fraction * 100)}%.`));
  }

  moveBreakeven(brokerOrderId: string, price: number): Promise<BrokerOrderResult> {
    return Promise.resolve(this.manage(brokerOrderId, `Demo stop moved to breakeven ${price.toFixed(2)}.`));
  }

  earlyExit(brokerOrderId: string): Promise<BrokerOrderResult> {
    this.pending.delete(brokerOrderId);
    return Promise.resolve({
      accepted: true,
      brokerOrderId,
      status: "FILLED",
      message: "Demo early exit executed."
    });
  }

  private manage(brokerOrderId: string, message: string): BrokerOrderResult {
    if (!this.pending.has(brokerOrderId) && !brokerOrderId.startsWith("demo-")) {
      return { accepted: false, status: "REJECTED", message: "Unknown demo order." };
    }
    return { accepted: true, brokerOrderId, status: "FILLED", message };
  }
}

const capabilityKey = (action: BrokerAction): keyof BrokerCapabilities => {
  switch (action) {
    case "ENTER":
      return "entry";
    case "SET_STOP_LOSS":
      return "stopLoss";
    case "SET_TAKE_PROFIT":
      return "takeProfit";
    case "PARTIAL_CLOSE":
      return "partialClose";
    case "MOVE_BREAKEVEN":
      return "moveBreakeven";
    case "EARLY_EXIT":
      return "earlyExit";
    case "CANCEL_PENDING":
      return "cancelPending";
  }
};
