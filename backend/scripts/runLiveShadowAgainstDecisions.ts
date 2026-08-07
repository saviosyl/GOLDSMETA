#!/usr/bin/env npx tsx
/**
 * Run LIVE SHADOW evaluation against recent genuine production decisions.
 * Never calls the Live order endpoint. Masked output only.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createStore } from "../src/services/storage/createStore";
import { processDecisionForLiveShadow } from "../src/services/broker/ctrader/liveShadowExecution";
import {
  isCTraderLiveEnabled,
  isCTraderLiveExecutionOwnerApproved,
  snapshotCTraderFlags
} from "../src/services/broker/ctrader/flags";
import { listRecentLiveShadowExecutions } from "../src/services/broker/ctrader/liveShadowStore";
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
  process.env.CTRADER_QUOTE_REQUIRE_LIVE =
    process.env.CTRADER_QUOTE_REQUIRE_LIVE || "true";

  const ownerUid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  if (!ownerUid) throw new Error("GOLDMETA_PINNED_OWNER_UID missing");

  const limit = Number(process.env.SHADOW_DECISION_LIMIT ?? "15") || 15;
  const store = createStore();
  const db = getFirestore();
  const snap = await db
    .collection(`users/${ownerUid}/decisions`)
    .orderBy("generatedAt", "desc")
    .limit(Math.max(limit * 3, 30))
    .get();

  const candidates = snap.docs
    .map((d) => d.data() as { decisionId?: string; decision?: string; generatedAt?: string })
    .filter((d) => {
      const code = String(d.decision ?? "").toUpperCase();
      return code === "BUY" || code === "SELL";
    })
    .slice(0, limit);

  console.log(
    JSON.stringify(
      {
        step: "flags",
        flags: snapshotCTraderFlags(),
        isCTraderLiveEnabled: isCTraderLiveEnabled(),
        ownerApproved: isCTraderLiveExecutionOwnerApproved(),
        candidateCount: candidates.length
      },
      null,
      2
    )
  );

  const results = [];
  for (const c of candidates) {
    const decisionId = String(c.decisionId ?? "");
    if (!decisionId) continue;
    const r = await processDecisionForLiveShadow({
      userId: ownerUid,
      decisionId,
      store,
      force: true
    });
    results.push({
      decisionId,
      decision: c.decision,
      generatedAt: c.generatedAt ?? null,
      outcome: r.outcome,
      skipped: r.skipped,
      message: r.message,
      accountMasked: r.record?.accountMasked ?? null,
      wouldSubmit: r.record?.wouldSubmit
        ? {
            side: r.record.wouldSubmit.side,
            lots: r.record.wouldSubmit.lots,
            volumeUnits: r.record.wouldSubmit.volumeUnits,
            entry: r.record.wouldSubmit.entry,
            stopLoss: r.record.wouldSubmit.stopLoss,
            takeProfit: r.record.wouldSubmit.takeProfit,
            spread: r.record.wouldSubmit.spread,
            bid: r.record.wouldSubmit.bid,
            ask: r.record.wouldSubmit.ask,
            quoteFreshness: r.record.wouldSubmit.quoteFreshness,
            accountMasked: r.record.wouldSubmit.accountMasked
          }
        : null,
      failedGates: r.record?.failedGates ?? [],
      passedGates: r.record?.passedGates ?? [],
      liveOrderEndpointCalled: false
    });
  }

  const recent = await listRecentLiveShadowExecutions(ownerUid, 20);
  const evidence = {
    ok: true,
    mode: "SHADOW",
    liveOrderEndpointCalled: false,
    isCTraderLiveEnabled: false,
    ownerApproved: false,
    evaluated: results.length,
    wouldSubmitCount: results.filter((r) => r.outcome === "SHADOW_WOULD_SUBMIT")
      .length,
    blockedCount: results.filter((r) => r.outcome === "SHADOW_BLOCKED").length,
    results,
    recentPersisted: recent.map((r) => ({
      decisionId: r.decisionId,
      decision: r.decision,
      outcome: r.outcome,
      accountMasked: r.accountMasked,
      rejectionReasons: r.rejectionReasons,
      wouldSubmit: r.wouldSubmit
        ? {
            side: r.wouldSubmit.side,
            lots: r.wouldSubmit.lots,
            entry: r.wouldSubmit.entry,
            stopLoss: r.wouldSubmit.stopLoss,
            takeProfit: r.wouldSubmit.takeProfit,
            spread: r.wouldSubmit.spread
          }
        : null,
      createdAt: r.createdAt
    }))
  };

  const outPath =
    process.env.SHADOW_EVIDENCE_PATH ||
    "/opt/cursor/artifacts/live-shadow-evidence.json";
  writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ evidencePath: outPath }, null, 2));
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      error: e instanceof Error ? e.message : String(e)
    })
  );
  process.exit(1);
});
