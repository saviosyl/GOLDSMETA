import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { writeFileSync } from "node:fs";
import { createStore } from "../src/services/storage/createStore";
import { processDecisionForLiveShadow } from "../src/services/broker/ctrader/liveShadowExecution";
import { buildIntentKey } from "../src/services/broker/ctrader/preview";
import { getConnection } from "../src/services/broker/ctrader/connectionStore";
import {
  isCTraderLiveEnabled,
  isCTraderLiveExecutionOwnerApproved
} from "../src/services/broker/ctrader/flags";

const TARGETS = [
  "35ffb2c092f43618eb914281", // 09:30 BUY near-miss
  "1a3d514d984c41df7846f5e3" // 09:45 BUY
];

async function main() {
  if (!getApps().length) initializeApp({ projectId: "goldmeta-web" });
  if (isCTraderLiveEnabled() || isCTraderLiveExecutionOwnerApproved()) {
    throw new Error("CTRADER_LIVE_MUST_REMAIN_FALSE");
  }
  process.env.CTRADER_LIVE_SHADOW_ENABLED = "true";
  process.env.CTRADER_LIVE_ENABLED = "false";

  const uid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  const conn = await getConnection(uid);
  if (!conn?.selectedAccountId) throw new Error("no account");
  const db = getFirestore();
  const store = createStore();
  const results = [];

  for (const decisionId of TARGETS) {
    const decision = await store.getDecision(uid, decisionId);
    if (!decision) {
      results.push({ decisionId, error: "NOT_FOUND" });
      continue;
    }
    const d = String(decision.decision).toUpperCase();
    const intentKey = buildIntentKey({
      ownerUid: uid,
      broker: "pepperstone_ctrader",
      accountId: conn.selectedAccountId,
      environment: "LIVE",
      decisionId,
      symbolId: conn.symbolId ?? "unknown",
      action: d
    });

    // Remove prior shadow doc so we can re-evaluate with hardened schema.
    // Does NOT call Live NewOrder. Audit trail remains in ctraderLiveShadowAudit.
    const ref = db.doc(
      `users/${uid}/ctraderLiveShadowExecutions/${intentKey}`
    );
    const prior = await ref.get();
    const priorData = prior.exists ? prior.data() : null;
    if (prior.exists) await ref.delete();

    const r = await processDecisionForLiveShadow({
      userId: uid,
      decisionId,
      store,
      force: true
    });

    results.push({
      decisionId,
      decision: d,
      generatedAt: decision.generatedAt,
      priorOutcome: priorData?.outcome ?? null,
      priorFailedGates: priorData?.failedGates ?? null,
      priorPassedGates: priorData?.passedGates ?? null,
      priorWouldSubmit: priorData?.wouldSubmit ?? null,
      reeval: {
        outcome: r.outcome,
        signalFreshnessClass: r.record?.signalFreshnessClass ?? null,
        decisionTimestamp: r.record?.decisionTimestamp ?? null,
        quoteTimestamp: r.record?.quoteTimestamp ?? null,
        plan: r.record?.plan ?? null,
        executableEntry: r.record?.executableEntry ?? null,
        calculatedSlippage: r.record?.calculatedSlippage ?? null,
        maxSlippageAllowed: r.record?.maxSlippageAllowed ?? null,
        balance: r.record?.balance ?? null,
        equity: r.record?.equity ?? null,
        freeMargin: r.record?.freeMargin ?? null,
        usedMargin: r.record?.usedMargin ?? null,
        currency: r.record?.currency ?? null,
        leverage: r.record?.leverage ?? null,
        riskAmount: r.record?.riskAmount ?? null,
        riskPercent: r.record?.riskPercent ?? null,
        stopDistance: r.record?.stopDistance ?? null,
        rawLotSize: r.record?.rawLotSize ?? null,
        roundedLotSize: r.record?.roundedLotSize ?? null,
        volumeUnits: r.record?.volumeUnits ?? null,
        marginEligible: r.record?.marginEligible ?? null,
        duplicateCheck: r.record?.duplicateCheck ?? null,
        reconcileOk: r.record?.reconcileOk ?? null,
        marketOpen: r.record?.marketOpen ?? null,
        failedGates: r.record?.failedGates ?? [],
        passedGates: r.record?.passedGates ?? [],
        wouldSubmit: r.record?.wouldSubmit ?? null,
        ctraderOrderPayload: r.record?.wouldSubmit?.ctraderOrderPayload ?? null,
        liveOrderEndpointCalled: false,
        protoOANewOrderReqCallCount: 0,
        isCTraderLiveEnabled: false,
        isCTraderLiveExecutionOwnerApproved: false
      }
    });
  }

  const out = {
    ok: true,
    mode: "SHADOW",
    liveOrderEndpointCalled: false,
    protoOANewOrderReqCallCount: 0,
    isCTraderLiveEnabled: false,
    isCTraderLiveExecutionOwnerApproved: false,
    accountMasked: "48…06",
    results
  };
  writeFileSync(
    "/opt/cursor/artifacts/live-shadow-new-production-reeval.json",
    JSON.stringify(out, null, 2)
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
