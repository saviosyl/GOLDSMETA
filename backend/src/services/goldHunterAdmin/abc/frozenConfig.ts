/**
 * Frozen GOLD_HUNTER FAST observation config.
 * DO NOT retune thresholds during a single Demo evaluation run.
 */
import { createHash } from "node:crypto";
import { defaultGhFastConfig } from "./defaults";
import type { GhFastConfig } from "./types";
import {
  GOLD_HUNTER_FAST_ENGINE_VERSION,
  GOLD_HUNTER_FAST_STRATEGY_VERSION
} from "./versions";

/** Canonical frozen config — identical to the current defaults for this brain. */
export function frozenGhFastSoakConfig(): GhFastConfig {
  return defaultGhFastConfig({});
}

export function hashGhFastConfig(cfg: GhFastConfig): string {
  const canonical = JSON.stringify(cfg, Object.keys(cfg).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export type GhFastFrozenIdentity = {
  engineVersion: typeof GOLD_HUNTER_FAST_ENGINE_VERSION;
  strategyVersion: typeof GOLD_HUNTER_FAST_STRATEGY_VERSION;
  soakLabel: "BRAIN_V6_R03_PULSE_GUARD_RELIABILITY_SMART_PM_V1_SMART_LOSS_V1_DEMO";
  configSha256: string;
  config: GhFastConfig;
  shadowOnly: true;
  brokerExecutionEnabled: false;
  mutationSurface: "NONE";
  maxOpenPositions: 1;
  tuningAllowed: false;
};

let cached: GhFastFrozenIdentity | null = null;

export function getFrozenGhFastIdentity(): GhFastFrozenIdentity {
  if (cached) return cached;
  const config = frozenGhFastSoakConfig();
  cached = {
    engineVersion: GOLD_HUNTER_FAST_ENGINE_VERSION,
    strategyVersion: GOLD_HUNTER_FAST_STRATEGY_VERSION,
    soakLabel: "BRAIN_V6_R03_PULSE_GUARD_RELIABILITY_SMART_PM_V1_SMART_LOSS_V1_DEMO",
    configSha256: hashGhFastConfig(config),
    config,
    shadowOnly: true,
    brokerExecutionEnabled: false,
    mutationSurface: "NONE",
    maxOpenPositions: 1,
    tuningAllowed: false
  };
  return cached;
}

/** Test helper — do not use in production path. */
export function resetFrozenGhFastIdentityForTests(): void {
  cached = null;
}

/**
 * Shadow qualification keeps legacy exits disabled for comparison.
 * Demo forward uses SMART_POSITION_MANAGER_V1 + SMART_LOSS_CONTROLLER_V1.
 */
export function frozenGhFastShadowExitConfig(): GhFastConfig {
  return {
    ...frozenGhFastSoakConfig(),
    smartPositionManagerEnabled: false,
    smartLossControllerEnabled: false
  };
}
