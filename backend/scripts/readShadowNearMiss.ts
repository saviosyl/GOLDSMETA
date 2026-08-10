import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { writeFileSync } from "node:fs";
import { listRecentLiveShadowExecutions } from "../src/services/broker/ctrader/liveShadowStore";
import {
  isCTraderLiveEnabled,
  isCTraderLiveExecutionOwnerApproved
} from "../src/services/broker/ctrader/flags";

async function main() {
  if (!getApps().length) initializeApp({ projectId: "goldmeta-web" });
  if (isCTraderLiveEnabled() || isCTraderLiveExecutionOwnerApproved()) {
    throw new Error("CTRADER_LIVE_MUST_REMAIN_FALSE");
  }
  const uid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  const recent = await listRecentLiveShadowExecutions(uid, 30);
  const byId = Object.fromEntries(recent.map((r) => [r.decisionId, r]));
  const target = byId["77b2b49ac09bc156c06581df"] ?? null;
  const summary = {
    isCTraderLiveEnabled: false,
    isCTraderLiveExecutionOwnerApproved: false,
    protoOANewOrderReqCallCount: 0,
    liveOrderEndpointCalled: false,
    nearMissDecisionId: "77b2b49ac09bc156c06581df",
    nearMiss: target
      ? {
          decisionId: target.decisionId,
          decision: target.decision,
          outcome: target.outcome,
          accountMasked: target.accountMasked,
          failedGates: target.failedGates,
          passedGates: target.passedGates,
          signalFreshnessClass: target.signalFreshnessClass,
          plan: target.plan,
          wouldSubmit: target.wouldSubmit,
          equity: target.equity,
          balance: target.balance,
          freeMargin: target.freeMargin,
          createdAt: target.createdAt
        }
      : null,
    recentOutcomes: recent.map((r) => ({
      decisionId: r.decisionId,
      decision: r.decision,
      outcome: r.outcome,
      failedGates: r.failedGates,
      createdAt: r.createdAt,
      equity: r.equity
    }))
  };
  writeFileSync(
    "/opt/cursor/artifacts/live-shadow-nearmiss.json",
    JSON.stringify(summary, null, 2)
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
