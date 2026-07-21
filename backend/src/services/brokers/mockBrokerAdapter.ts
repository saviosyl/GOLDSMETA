import { setupLifecycleConfig } from "../../config/setupLifecycleConfig";
import { nowIso } from "../../utils/time";
import { logger } from "../logging/logger";
import type {
  ExecutionBrokerAdapter,
  ExecutionBrokerAccount,
  ExecutionBrokerMarket,
  ExecutionOrderRequest,
  ExecutionOrderResult,
  ExecutionBrokerPosition,
  ExecutionBrokerQuote
} from "./executionBroker";

/**
 * In-memory mock execution broker. Never contacts IG. LIVE place is always rejected via config.
 */
export class MockBrokerAdapter implements ExecutionBrokerAdapter {
  readonly name = "mock-demo";
  private positions: ExecutionBrokerPosition[] = [];
  private orders = new Map<string, ExecutionOrderResult>();
  private usedKeys = new Set<string>();

  getAccounts(): Promise<ExecutionBrokerAccount[]> {
    return Promise.resolve([
      {
        accountId: "demo-001",
        name: "GoldMeta Mock Demo",
        currency: "USD",
        environment: "DEMO",
        balance: 10000
      }
    ]);
  }

  getMarket(symbol: string): Promise<ExecutionBrokerMarket> {
    return Promise.resolve({
      symbol,
      epic: `MOCK.${symbol}`,
      marketStatus: "OPEN",
      minDealSize: 0.1
    });
  }

  getQuote(symbol: string): Promise<ExecutionBrokerQuote> {
    return Promise.resolve({
      symbol,
      bid: 2400,
      offer: 2400.3,
      asOf: nowIso(),
      stale: false
    });
  }

  getOpenPositions(): Promise<ExecutionBrokerPosition[]> {
    return Promise.resolve([...this.positions]);
  }

  previewOrder(_request: ExecutionOrderRequest): Promise<ExecutionOrderResult> {
    if (setupLifecycleConfig.flags.brokerLiveExecutionEnabled) {
      return Promise.resolve(this.reject("LIVE_EXECUTION_ENABLED_IN_CONFIG_BLOCKED"));
    }
    return Promise.resolve({
      accepted: true,
      orderId: null,
      status: "ACCEPTED",
      reason: "Preview only — no order placed"
    });
  }

  placeDemoOrder(request: ExecutionOrderRequest): Promise<ExecutionOrderResult> {
    if (setupLifecycleConfig.flags.brokerLiveExecutionEnabled) {
      return Promise.resolve(this.reject("LIVE_EXECUTION_HARD_DISABLED"));
    }
    if (!setupLifecycleConfig.flags.brokerDemoOnlyEnabled) {
      return Promise.resolve(this.reject("DEMO_BROKER_DISABLED"));
    }
    if (this.usedKeys.has(request.idempotencyKey)) {
      return Promise.resolve(this.reject("DUPLICATE_IDEMPOTENCY_KEY"));
    }
    if (this.positions.length >= 1) {
      return Promise.resolve(this.reject("MAX_ONE_POSITION"));
    }
    this.usedKeys.add(request.idempotencyKey);
    const orderId = `mock-${request.idempotencyKey.slice(0, 12)}`;
    const result: ExecutionOrderResult = {
      accepted: true,
      orderId,
      status: "FILLED",
      reason: "Mock demo fill (not IG)"
    };
    this.orders.set(orderId, result);
    this.positions.push({
      positionId: `pos-${orderId}`,
      symbol: request.symbol,
      direction: request.direction,
      size: request.size,
      openLevel: request.entryLevel ?? 2400,
      stopLevel: request.stopLevel ?? null,
      limitLevel: request.limitLevel ?? null
    });
    logger.info("Mock demo order filled", { orderId, symbol: request.symbol });
    return Promise.resolve(result);
  }

  amendDemoOrder(orderId: string, _patch: Partial<ExecutionOrderRequest>): Promise<ExecutionOrderResult> {
    const existing = this.orders.get(orderId);
    if (!existing) {
      return Promise.resolve(this.reject("ORDER_NOT_FOUND"));
    }
    return Promise.resolve({ ...existing, reason: "Mock amend accepted" });
  }

  closeDemoPosition(positionId: string): Promise<ExecutionOrderResult> {
    const before = this.positions.length;
    this.positions = this.positions.filter((p) => p.positionId !== positionId);
    if (this.positions.length === before) {
      return Promise.resolve(this.reject("POSITION_NOT_FOUND"));
    }
    return Promise.resolve({
      accepted: true,
      orderId: positionId,
      status: "CANCELLED",
      reason: "Mock position closed"
    });
  }

  getOrderStatus(orderId: string): Promise<ExecutionOrderResult> {
    return Promise.resolve(this.orders.get(orderId) ?? this.reject("ORDER_NOT_FOUND"));
  }

  private reject(reason: string): ExecutionOrderResult {
    return { accepted: false, orderId: null, status: "REJECTED", reason };
  }
}

/** Spec notes for a future IG demo adapter (not implemented). */
export const IG_DEMO_ADAPTER_PLAN = {
  auth: "CST/X-SECURITY-TOKEN session via server-side API key; no passwords in frontend",
  rotation: "Support API key rotation; expire sessions; refresh on 401",
  rateLimits: "Backoff + queue; never burst placeDemoOrder",
  safety: [
    "brokerLiveExecutionEnabled must remain false until explicit approval",
    "max 1 position",
    "max risk per trade / daily loss / trades per day",
    "emergency stop",
    "spread/slippage/stale quote/market-hours guards",
    "idempotency keys + audit log"
  ],
  liveExecutionHardDisabled: true as const,
  endpoints: [
    "getAccounts",
    "getMarket",
    "getQuote",
    "getOpenPositions",
    "previewOrder",
    "placeDemoOrder",
    "amendDemoOrder",
    "closeDemoPosition",
    "getOrderStatus"
  ]
} as const;
