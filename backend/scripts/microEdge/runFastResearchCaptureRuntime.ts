/**
 * Entrypoint: npm run gold-hunter:fast-research-collector
 *
 * Dedicated GOLD_HUNTER FAST continuous research capture service.
 * Completely separate from:
 * - gold-hunter-fast-shadow
 * - Core AutoTrade
 * - production trading runtime
 *
 * SAFETY:
 * - mode=RESEARCH_CAPTURE_ONLY
 * - campaignMode=true
 * - MICRO_BROKER_EXECUTION_ENABLED=false
 * - SCOPE_VIEW verified from actual broker GetAccountList response
 * - executionAdapter=NONE / mutationSurface=NONE
 * - NO shadow trades, NO broker orders, NO ENTER/EXIT
 * - Storage prefix: gold-hunter-fast/research-capture/ (never live-shadow)
 *
 * Continuous operation across trading days until explicitly stopped.
 * Five clean days = earliest analysis checkpoint only (prefer 10+).
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { MICRO_BROKER_EXECUTION_ENABLED } from "../../src/services/microEdge/config";
import { runGoldHunterFastResearchCaptureProcessMain } from "../../src/services/microEdge/runtime/fastResearchCaptureProcess";

if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
  console.error("REFUSING: MICRO_BROKER_EXECUTION_ENABLED must be false");
  process.exit(1);
}

// Never enable shadow trading path in this process.
process.env.GOLD_HUNTER_FAST_SHADOW_ENABLED = "false";
process.env.MICRO_BROKER_EXECUTION_ENABLED =
  process.env.MICRO_BROKER_EXECUTION_ENABLED ?? "false";

if (!(process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET ?? "").trim()) {
  console.error(
    "REFUSING: GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET must be set explicitly for campaignMode"
  );
  process.exit(1);
}

console.log(
  JSON.stringify({
    service: "gold-hunter-fast-research-collector",
    mode: "RESEARCH_CAPTURE_ONLY",
    campaignMode: true,
    mutationSurface: "NONE",
    executionAdapter: "NONE",
    brokerExecutionEnabled: false,
    shadowEnabled: false,
    continuousOperation: true,
    autoStopAfterFiveDays: false,
    storagePrefix: "gold-hunter-fast/research-capture",
    researchGcsBucket: process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET,
    deployGitSha: process.env.GOLD_HUNTER_FAST_DEPLOY_GIT_SHA ?? null
  })
);

if (getApps().length === 0) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || undefined });
}

runGoldHunterFastResearchCaptureProcessMain().catch((e) => {
  console.error("FAST research capture runtime failed:", (e as Error).message);
  process.exit(1);
});
