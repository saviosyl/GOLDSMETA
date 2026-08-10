/**
 * Evaluate one decision in LIVE SHADOW (force). Never submits orders.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createStore } from "../src/services/storage/createStore";
import { processDecisionForLiveShadow } from "../src/services/broker/ctrader/liveShadowExecution";
import { getConnection } from "../src/services/broker/ctrader/connectionStore";
import { buildIntentKey } from "../src/services/broker/ctrader/preview";
import {
  isCTraderLiveEnabled,
  isCTraderLiveExecutionOwnerApproved,
  snapshotCTraderFlags
} from "../src/services/broker/ctrader/flags";
import { writeFileSync } from "node:fs";

async function main() {
  if (!getApps().length) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
  }
  if (isCTraderLiveEnabled() || isCTraderLiveExecutionOwnerApproved()) {
    throw new Error("CTRADER_LIVE_MUST_REMAIN_FALSE");
  }
  process.env.CTRADER_LIVE_SHADOW_ENABLED = "true";
  process.env.CTRADER_LIVE_ENABLED = "false";

  const ownerUid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  const decisionId = (process.env.SHADOW_DECISION_ID || "").trim();
  if (!ownerUid || !decisionId) throw new Error("UID_OR_DECISION_MISSING");

  const conn = await getConnection(ownerUid);
  const store = createStore();
  const db = getFirestore();

  if (process.env.SHADOW_WATCH_REEVAL === "true" && conn?.selectedAccountId) {
    const decision = await store.getDecision(ownerUid, decisionId);
    const code = String(decision?.decision ?? "").toUpperCase();
    const intentKey = buildIntentKey({
      ownerUid,
      broker: "pepperstone_ctrader",
      accountId: conn.selectedAccountId,
      environment: "LIVE",
      decisionId,
      symbolId: conn.symbolId ?? "unknown",
      action: code
    });
    await db
      .doc(`users/${ownerUid}/ctraderLiveShadowExecutions/${intentKey}`)
      .delete()
      .catch(() => undefined);
  }

  const r = await processDecisionForLiveShadow({
    userId: ownerUid,
    decisionId,
    store,
    force: true
  });

  const out = {
    flags: snapshotCTraderFlags(),
    isCTraderLiveEnabled: isCTraderLiveEnabled(),
    isCTraderLiveExecutionOwnerApproved:
      isCTraderLiveExecutionOwnerApproved(),
    connection: conn
      ? {
          hasSelected: Boolean(conn.selectedAccountId),
          selectedAccountIsLive: conn.selectedAccountIsLive,
          environment: conn.environment,
          currency: conn.currency,
          symbolId: conn.symbolId
        }
      : null,
    skipped: r.skipped,
    outcome: r.outcome,
    message: r.message,
    intentKey: r.intentKey,
    record: r.record
  };
  writeFileSync(
    "/opt/cursor/artifacts/live-shadow-funded-one-eval.json",
    JSON.stringify(out, null, 2)
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
