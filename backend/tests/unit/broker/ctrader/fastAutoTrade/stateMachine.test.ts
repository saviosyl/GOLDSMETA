import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAST_AUTOTRADE_CONFIG,
  isPendingStateStuck,
  nextLifecycleState
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";

describe("FAST_AUTOTRADE_V1 state machine", () => {
  it("cannot remain indefinitely stuck in pending states", () => {
    const entered = 1_000;
    const stuckSetup = isPendingStateStuck(
      { state: "SETUP_FOUND", stateEnteredAtMs: entered },
      entered + DEFAULT_FAST_AUTOTRADE_CONFIG.pendingSetupTimeoutMs,
      DEFAULT_FAST_AUTOTRADE_CONFIG
    );
    const stuckTrigger = isPendingStateStuck(
      { state: "TRIGGER_PENDING", stateEnteredAtMs: entered },
      entered + DEFAULT_FAST_AUTOTRADE_CONFIG.pendingTriggerTimeoutMs,
      DEFAULT_FAST_AUTOTRADE_CONFIG
    );
    const stuckEntry = isPendingStateStuck(
      { state: "ENTRY_PENDING", stateEnteredAtMs: entered },
      entered + DEFAULT_FAST_AUTOTRADE_CONFIG.pendingEntryTimeoutMs,
      DEFAULT_FAST_AUTOTRADE_CONFIG
    );
    expect(stuckSetup).toBe(true);
    expect(stuckTrigger).toBe(true);
    expect(stuckEntry).toBe(true);

    const reset = nextLifecycleState({
      current: { state: "TRIGGER_PENDING", stateEnteredAtMs: entered },
      nowMs: entered + DEFAULT_FAST_AUTOTRADE_CONFIG.pendingTriggerTimeoutMs,
      hasSetup: true,
      hasTrigger: false,
      readyToEnter: false,
      isOpen: false,
      exiting: false,
      closed: false
    });
    expect(reset.state).toBe("SCANNING");
  });

  it("advances SCANNING → SETUP_FOUND → ENTRY_PENDING → MANAGING → RESET", () => {
    const t0 = 10_000;
    const setup = nextLifecycleState({
      current: { state: "SCANNING", stateEnteredAtMs: t0 },
      nowMs: t0 + 1_000,
      hasSetup: true,
      hasTrigger: false,
      readyToEnter: false,
      isOpen: false,
      exiting: false,
      closed: false
    });
    expect(setup.state).toBe("SETUP_FOUND");
    const entry = nextLifecycleState({
      current: setup,
      nowMs: t0 + 2_000,
      hasSetup: true,
      hasTrigger: true,
      readyToEnter: true,
      isOpen: false,
      exiting: false,
      closed: false
    });
    expect(entry.state).toBe("ENTRY_PENDING");
    const managing = nextLifecycleState({
      current: entry,
      nowMs: t0 + 3_000,
      hasSetup: true,
      hasTrigger: true,
      readyToEnter: true,
      isOpen: true,
      exiting: false,
      closed: false
    });
    expect(managing.state).toBe("MANAGING");
    const reset = nextLifecycleState({
      current: managing,
      nowMs: t0 + 4_000,
      hasSetup: false,
      hasTrigger: false,
      readyToEnter: false,
      isOpen: false,
      exiting: false,
      closed: true
    });
    expect(reset.state).toBe("RESET");
  });
});
