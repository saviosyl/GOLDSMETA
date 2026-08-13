/**
 * Entrypoint: npm run micro-edge:collector
 * Persistent Micro live collector (Cloud Run / container).
 * READ-ONLY — uses Micro OAuth vault; never Core access/refresh tokens.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { runMicroLiveCollectorWorkerMain } from "../../src/services/microEdge/runtime/liveCollectorWorker";
import { MICRO_BROKER_EXECUTION_ENABLED } from "../../src/services/microEdge/config";

if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
  console.error("REFUSING: MICRO_BROKER_EXECUTION_ENABLED must be false");
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
}

runMicroLiveCollectorWorkerMain().catch((e) => {
  console.error("Collector failed:", (e as Error).message);
  process.exit(1);
});
