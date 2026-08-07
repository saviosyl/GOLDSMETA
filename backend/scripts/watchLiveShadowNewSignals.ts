#!/usr/bin/env npx tsx
/**
 * Listen for NEW production BUY/SELL decisions after a cutoff and evaluate
 * LIVE SHADOW only. Never calls the Live order endpoint.
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
import { writeFileSync } from "node:fs";

type DecisionRow = {
  decisionId?: string;
  decision?: string;
  generatedAt?: string;
  confidence?: number;
  confidenceLabel?: string;
  setupScore?: number;
  entry?: { price?: number };
  stopLoss?: { price?: number };
  takeProfits?: Array<{ label?: string; price?: number }>;
};

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
  if (!ownerUid) throw new Error("GOLDMETA_PINNED_OWNER_UID missing");

  const sinceIso =
    process.env.SHADOW_WATCH_SINCE || new Date().toISOString();
  const pollMs = Number(process.env.SHADOW_WATCH_POLL_MS ?? "15000") || 15000;
  const maxWaitMs =
    Number(process.env.SHADOW_WATCH_MAX_MS ?? String(45 * 60 * 1000)) ||
    45 * 60 * 1000;
  const store = createStore();
  const db = getFirestore();
  const seen = new Set<string>();
  const results: Array<Record<string, unknown>> = [];
  const startedAt = Date.now();

  console.log(
    JSON.stringify(
      {
        step: "watch_start",
        sinceIso,
        pollMs,
        maxWaitMs,
        flags: snapshotCTraderFlags(),
        isCTraderLiveEnabled: isCTraderLiveEnabled(),
        ownerApproved: isCTraderLiveExecutionOwnerApproved()
      },
      null,
      2
    )
  );

  while (Date.now() - startedAt < maxWaitMs) {
    const snap = await db
      .collection(`users/${ownerUid}/decisions`)
      .where("generatedAt", ">=", sinceIso)
      .orderBy("generatedAt", "asc")
      .limit(50)
      .get();

    for (const doc of snap.docs) {
      const c = doc.data() as DecisionRow;
      const decisionId = String(c.decisionId ?? doc.id);
      const code = String(c.decision ?? "").toUpperCase();
      if (code !== "BUY" && code !== "SELL") continue;
      if (seen.has(decisionId)) continue;
      seen.add(decisionId);

      const r = await processDecisionForLiveShadow({
        userId: ownerUid,
        decisionId,
        store,
        force: true
      });

      const rec = r.record;
      results.push({
        decisionId,
        decision: code,
        decisionTimestamp: c.generatedAt ?? rec?.decisionTimestamp ?? null,
        quoteTimestamp: rec?.quoteTimestamp ?? null,
        setupQuality: {
          confidence: c.confidence ?? rec?.confidence ?? null,
          confidenceLabel: c.confidenceLabel ?? rec?.plan?.confidenceLabel ?? null,
          setupScore: c.setupScore ?? rec?.plan?.setupScore ?? null
        },
        plan: rec?.plan ?? {
          plannedEntry: c.entry?.price ?? null,
          stopLoss: c.stopLoss?.price ?? null,
          takeProfit1:
            c.takeProfits?.find((t) => t.label === "TP1")?.price ?? null,
          takeProfit2:
            c.takeProfits?.find((t) => t.label === "TP2")?.price ?? null,
          takeProfit3:
            c.takeProfits?.find((t) => t.label === "TP3")?.price ?? null
        },
        outcome: r.outcome,
        signalFreshnessClass: rec?.signalFreshnessClass ?? null,
        executableEntry: rec?.executableEntry ?? null,
        bid: rec?.wouldSubmit?.bid ?? null,
        ask: rec?.wouldSubmit?.ask ?? null,
        spread: rec?.wouldSubmit?.spread ?? null,
        calculatedSlippage: rec?.calculatedSlippage ?? null,
        balance: rec?.balance ?? null,
        equity: rec?.equity ?? null,
        freeMargin: rec?.freeMargin ?? null,
        riskAmount: rec?.riskAmount ?? null,
        riskPercent: rec?.riskPercent ?? null,
        stopDistance: rec?.stopDistance ?? null,
        rawLotSize: rec?.rawLotSize ?? null,
        roundedLotSize: rec?.roundedLotSize ?? null,
        volumeUnits: rec?.volumeUnits ?? null,
        marginEligible: rec?.marginEligible ?? null,
        duplicateCheck: rec?.duplicateCheck ?? null,
        reconcileOk: rec?.reconcileOk ?? null,
        marketOpen: rec?.marketOpen ?? null,
        failedGates: rec?.failedGates ?? [],
        passedGates: rec?.passedGates ?? [],
        wouldSubmit: rec?.wouldSubmit ?? null,
        ctraderOrderPayload: rec?.wouldSubmit?.ctraderOrderPayload ?? null,
        liveOrderEndpointCalled: false,
        protoOANewOrderReqCallCount: 0,
        isCTraderLiveEnabled: false,
        isCTraderLiveExecutionOwnerApproved: false
      });

      console.log(
        JSON.stringify(
          {
            step: "evaluated",
            decisionId,
            decision: code,
            outcome: r.outcome,
            signalFreshnessClass: rec?.signalFreshnessClass,
            failedGates: rec?.failedGates ?? []
          },
          null,
          2
        )
      );

      if (r.outcome === "SHADOW_WOULD_SUBMIT") {
        break;
      }
    }

    if (results.some((x) => x.outcome === "SHADOW_WOULD_SUBMIT")) break;

    await new Promise((r) => setTimeout(r, pollMs));
  }

  const blocked = results.filter((r) => r.outcome === "SHADOW_BLOCKED");
  const reasonCounts: Record<string, number> = {};
  for (const b of blocked) {
    for (const g of (b.failedGates as string[]) ?? []) {
      reasonCounts[g] = (reasonCounts[g] ?? 0) + 1;
    }
  }

  const evidence = {
    ok: true,
    mode: "SHADOW",
    watchSince: sinceIso,
    watchEndedAt: new Date().toISOString(),
    waitedMs: Date.now() - startedAt,
    liveOrderEndpointCalled: false,
    protoOANewOrderReqCallCount: 0,
    isCTraderLiveEnabled: false,
    isCTraderLiveExecutionOwnerApproved: false,
    newProductionSignalsEvaluated: results.length,
    wouldSubmitCount: results.filter((r) => r.outcome === "SHADOW_WOULD_SUBMIT")
      .length,
    blockedCount: blocked.length,
    blockedByReason: reasonCounts,
    freshCount: results.filter((r) => r.signalFreshnessClass === "FRESH_SIGNAL")
      .length,
    staleCount: results.filter((r) => r.signalFreshnessClass === "STALE_SIGNAL")
      .length,
    firstWouldSubmit: results.find((r) => r.outcome === "SHADOW_WOULD_SUBMIT") ?? null,
    results
  };

  const outPath =
    process.env.SHADOW_WATCH_EVIDENCE_PATH ||
    "/opt/cursor/artifacts/live-shadow-fresh-watch.json";
  writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ evidencePath: outPath }, null, 2));
}

main().catch((e) => {
  console.error(
    JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
  );
  process.exit(1);
});
