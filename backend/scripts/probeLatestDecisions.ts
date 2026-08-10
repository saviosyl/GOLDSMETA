import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { writeFileSync } from "node:fs";

async function main() {
  if (!getApps().length) initializeApp({ projectId: "goldmeta-web" });
  const uid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  const snap = await getFirestore()
    .collection(`users/${uid}/decisions`)
    .orderBy("generatedAt", "desc")
    .limit(25)
    .get();
  const rows = snap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    const entry = x.entry as { price?: number } | undefined;
    const sl = x.stopLoss as { price?: number } | undefined;
    const tps = x.takeProfits as Array<{ label?: string; price?: number }> | undefined;
    return {
      decisionId: x.decisionId,
      decision: x.decision,
      generatedAt: x.generatedAt,
      confidence: x.confidence,
      confidenceLabel: x.confidenceLabel,
      setupScore: x.setupScore,
      entry: entry?.price ?? null,
      stopLoss: sl?.price ?? null,
      tp1: tps?.find((t) => t.label === "TP1")?.price ?? tps?.[0]?.price ?? null,
      tp2: tps?.find((t) => t.label === "TP2")?.price ?? null,
      tp3: tps?.find((t) => t.label === "TP3")?.price ?? null
    };
  });
  const buysells = rows.filter((r) => {
    const c = String(r.decision ?? "").toUpperCase();
    return c === "BUY" || c === "SELL";
  });
  const out = {
    now: new Date().toISOString(),
    latestBuySell: buysells.slice(0, 10),
    latestAny: rows.slice(0, 10)
  };
  writeFileSync(
    "/opt/cursor/artifacts/latest-decisions-probe.json",
    JSON.stringify(out, null, 2)
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
