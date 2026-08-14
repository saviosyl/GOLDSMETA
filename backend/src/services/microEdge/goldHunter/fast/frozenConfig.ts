/**
 * Frozen GOLD_HUNTER FAST observation config.
 * DO NOT retune thresholds during live-shadow soak collection.
 */
import { createHash } from "node:crypto";
import { defaultGhFastConfig } from "./defaults";
import type { GhFastConfig } from "./types";
import {
  GOLD_HUNTER_FAST_ENGINE_VERSION,
  GOLD_HUNTER_FAST_STRATEGY_VERSION
} from "./versions";

/** Canonical frozen soak config — identical to current conservative defaults. */
export function frozenGhFastSoakConfig(): GhFastConfig {
  // Explicit freeze: no overrides. Changing defaults.ts without bumping
  // ENGINE_VERSION / SHA is a process violation during soak.
  return defaultGhFastConfig({});
}

export function hashGhFastConfig(cfg: GhFastConfig): string {
  const canonical = JSON.stringify(cfg, Object.keys(cfg).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export type GhFastFrozenIdentity = {
  engineVersion: typeof GOLD_HUNTER_FAST_ENGINE_VERSION;
  strategyVersion: typeof GOLD_HUNTER_FAST_STRATEGY_VERSION;
  soakLabel: "LIVE_SHADOW_SOAK_V1";
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
    soakLabel: "LIVE_SHADOW_SOAK_V1",
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

/** Test helper — do not use in production soak path. */
export function resetFrozenGhFastIdentityForTests(): void {
  cached = null;
}
