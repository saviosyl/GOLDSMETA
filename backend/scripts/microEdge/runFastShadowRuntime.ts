/**
 * Entrypoint: npm run gold-hunter:fast-shadow
 *
 * Dedicated GOLD_HUNTER FAST live-shadow soak runtime.
 * Separate process from Core AutoTrade and normal Micro collector.
 *
 * SAFETY:
 * - MICRO_BROKER_EXECUTION_ENABLED=false
 * - ShadowExecutionAdapter only
 * - mutationSurface=NONE
 * - SCOPE_VIEW / trade OAuth unavailable
 * - NO Demo or Live broker orders
 * - Frozen soak config (no threshold retuning)
 *
 * Deploy only after explicit human approval. Do not merge/enable by default.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { MICRO_BROKER_EXECUTION_ENABLED } from "../../src/services/microEdge/config";
import { runGoldHunterFastShadowRuntimeMain } from "../../src/services/microEdge/runtime/fastShadowRuntime";
import { getFrozenGhFastIdentity } from "../../src/services/microEdge/goldHunter/fast";

if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
  console.error("REFUSING: MICRO_BROKER_EXECUTION_ENABLED must be false");
  process.exit(1);
}

process.env.GOLD_HUNTER_FAST_SHADOW_ENABLED = "true";
process.env.MICRO_BROKER_EXECUTION_ENABLED =
  process.env.MICRO_BROKER_EXECUTION_ENABLED ?? "false";

const frozen = getFrozenGhFastIdentity();
console.log(
  JSON.stringify({
    service: "gold-hunter-fast-shadow",
    soakLabel: frozen.soakLabel,
    engineVersion: frozen.engineVersion,
    configSha256: frozen.configSha256,
    tuningAllowed: frozen.tuningAllowed,
    mutationSurface: frozen.mutationSurface,
    brokerExecutionEnabled: frozen.brokerExecutionEnabled,
    shadowOnly: frozen.shadowOnly
  })
);

if (getApps().length === 0) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || "[REDACTED]" });
}

runGoldHunterFastShadowRuntimeMain().catch((e) => {
  console.error("FAST shadow runtime failed:", (e as Error).message);
  process.exit(1);
});
