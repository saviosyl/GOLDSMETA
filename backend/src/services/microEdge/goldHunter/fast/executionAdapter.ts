/**
 * Execution adapter interface — Demo-capable later, SHADOW-ONLY now.
 * Actual cTrader trade execution must remain impossible in this phase.
 */
import type { GhFastShadowOrder, GhFastSide, GhFastExitReason, GhFastSetupId } from "./types";
import {
  GH_FAST_BROKER_EXECUTION_ENABLED,
  GH_FAST_MUTATION_SURFACE,
  GH_FAST_SHADOW_ONLY
} from "./versions";

export type ExecutionIntent = {
  kind: "ENTER" | "EXIT";
  side: GhFastSide;
  price: number;
  timestampMs: number;
  setup: GhFastSetupId | null;
  exitReason: GhFastExitReason | null;
};

export interface GhFastExecutionAdapter {
  readonly name: string;
  readonly shadowOnly: true;
  readonly brokerExecutionEnabled: false;
  readonly mutationSurface: "NONE";
  submit(intent: ExecutionIntent): Promise<GhFastShadowOrder | null>;
}

/** Bound adapter for this phase — never sends broker orders. */
export class ShadowExecutionAdapter implements GhFastExecutionAdapter {
  readonly name = "ShadowExecutionAdapter";
  readonly shadowOnly = GH_FAST_SHADOW_ONLY;
  readonly brokerExecutionEnabled = GH_FAST_BROKER_EXECUTION_ENABLED;
  readonly mutationSurface = GH_FAST_MUTATION_SURFACE;
  private seq = 0;
  readonly orders: GhFastShadowOrder[] = [];

  async submit(intent: ExecutionIntent): Promise<GhFastShadowOrder | null> {
    if (this.brokerExecutionEnabled !== false) {
      throw new Error("REFUSING: broker execution must be false");
    }
    if (this.mutationSurface !== "NONE") {
      throw new Error("REFUSING: mutationSurface must be NONE");
    }
    this.seq += 1;
    const order: GhFastShadowOrder = {
      orderId: `gh_fast_shadow_${intent.kind}_${this.seq}_${intent.timestampMs}`,
      kind: intent.kind,
      side: intent.side,
      price: intent.price,
      timestampMs: intent.timestampMs,
      setup: intent.setup,
      exitReason: intent.exitReason,
      shadowOnly: true,
      brokerExecutionEnabled: false,
      mutationSurface: "NONE"
    };
    this.orders.push(order);
    return order;
  }
}

/**
 * Placeholder for a future Demo adapter — MUST throw if constructed in this phase.
 * Prevents accidental wiring to real order APIs.
 */
export class ForbiddenLiveExecutionAdapter implements GhFastExecutionAdapter {
  readonly name = "ForbiddenLiveExecutionAdapter";
  readonly shadowOnly = true as const;
  readonly brokerExecutionEnabled = false as const;
  readonly mutationSurface = "NONE" as const;

  constructor() {
    throw new Error(
      "REFUSING: live/demo execution adapter is not enabled in GOLD_HUNTER FAST phase"
    );
  }

  async submit(): Promise<null> {
    return null;
  }
}
