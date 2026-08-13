/**
 * Entrypoint: npm run micro-edge:collector
 * Persistent Micro live collector — DO NOT DEPLOY in this PR.
 */
import { runMicroLiveCollectorWorkerMain } from "../../src/services/microEdge/runtime/liveCollectorWorker";
import { MICRO_BROKER_EXECUTION_ENABLED } from "../../src/services/microEdge/config";

if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
  console.error("REFUSING: MICRO_BROKER_EXECUTION_ENABLED must be false");
  process.exit(1);
}

runMicroLiveCollectorWorkerMain().catch((e) => {
  console.error("Collector failed:", (e as Error).message);
  process.exit(1);
});
