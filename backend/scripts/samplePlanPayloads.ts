#!/usr/bin/env npx tsx
/** Read-only sample of recent raw event shapes. No secrets printed. */
const PROJECT_ID = "goldmeta-web";
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function token(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.FIREBASE_TOKEN as string,
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi"
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("token exchange failed");
  return json.access_token;
}

function decodeValue(v: unknown): unknown {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if ("nullValue" in o) return null;
  if ("stringValue" in o) return o.stringValue;
  if ("booleanValue" in o) return o.booleanValue;
  if ("integerValue" in o) return Number(o.integerValue);
  if ("doubleValue" in o) return Number(o.doubleValue);
  if ("timestampValue" in o) return o.timestampValue;
  if ("mapValue" in o) {
    const fields = ((o.mapValue as { fields?: Record<string, unknown> }).fields) ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(fields)) out[k] = decodeValue(val);
    return out;
  }
  if ("arrayValue" in o) {
    return ((o.arrayValue as { values?: unknown[] }).values ?? []).map(decodeValue);
  }
  return null;
}

function decodeDoc(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decodeValue(v);
  return out;
}

async function main(): Promise<void> {
  const t = await token();
  const users = await fetch(`${FS}/userDirectory?pageSize=20`, {
    headers: { Authorization: `Bearer ${t}` }
  });
  const uj = (await users.json()) as { documents?: Array<{ name: string }> };
  const samples: Array<Record<string, unknown>> = [];
  for (const doc of uj.documents ?? []) {
    const uid = doc.name.split("/").pop();
    const res = await fetch(`${FS}/users/${uid}/rawEvents?pageSize=40`, {
      headers: { Authorization: `Bearer ${t}` }
    });
    if (!res.ok) continue;
    const json = (await res.json()) as {
      documents?: Array<{ fields?: Record<string, unknown> }>;
    };
    for (const d of json.documents ?? []) {
      const row = decodeDoc(d.fields);
      const p = (row.payload as Record<string, unknown>) ?? row;
      const meta = (p.metadata as Record<string, unknown>) ?? {};
      const entry = p.entry as { price?: number; zoneLow?: number } | undefined;
      const stop = p.stopLoss as { price?: number } | undefined;
      const tps = (p.takeProfits as Array<{ label?: string }> | undefined) ?? [];
      samples.push({
        receivedAt: row.receivedAt,
        scriptVersion: meta.scriptVersion ?? null,
        schemaVersion: p.schemaVersion ?? meta.schemaVersion ?? null,
        alertRole: meta.alertRole ?? null,
        alertKind: meta.alertKind ?? p.alertKind ?? null,
        decision: p.decision ?? null,
        timeframe: p.timeframe ?? meta.timeframe ?? null,
        isConfirmedBar: p.isConfirmedBar ?? null,
        chartMatchesRole: meta.chartMatchesRole ?? null,
        planSourceKey: meta.planSourceKey ?? null,
        hasEntry: !!(entry?.price || entry?.zoneLow),
        hasStop: !!stop?.price,
        tpLabels: tps.map((x) => x.label),
        hasOhlcv: !!p.ohlcv,
        hasMarketStructure: !!(
          (p.marketStructure as { poc?: number } | undefined)?.poc ||
          (p.marketStructure as { vah?: number } | undefined)?.vah
        ),
        topKeys: Object.keys(p).slice(0, 18)
      });
    }
    if (samples.length >= 60) break;
  }

  const byKind: Record<string, number> = {};
  for (const s of samples) {
    const k = `${s.scriptVersion}|role=${s.alertRole}|kind=${s.alertKind}|dec=${s.decision}|tf=${s.timeframe}`;
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  const withLevels = samples.filter(
    (s) => s.hasEntry && s.hasStop && (s.tpLabels as string[]).includes("TP1")
  );

  const q = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "sessionPlans", allDescendants: true }],
          limit: 50
        }
      })
    }
  );
  const rows = (await q.json()) as Array<{
    document?: { name: string; fields?: Record<string, unknown> };
  }>;
  const actives = [];
  for (const r of rows) {
    if (!r.document?.name?.endsWith("/sessionPlans/active")) continue;
    const d = decodeDoc(r.document.fields);
    actives.push({
      lifecycleState: d.lifecycleState,
      direction: d.direction,
      geometryReasonCodes: d.geometryReasonCodes,
      planQualityReasons: (d.planQuality as { reasons?: string[] } | undefined)?.reasons ?? [],
      alertRole: d.alertRole,
      scriptVersion: d.scriptVersion,
      planStabilityLabel: d.planStabilityLabel,
      invalidation:
        typeof d.invalidation === "string" ? d.invalidation.slice(0, 160) : d.invalidation,
      updatedAt: d.updatedAt,
      hasEntry: !!d.entry,
      marketStructureMode: d.marketStructureMode
    });
  }

  console.log(
    JSON.stringify(
      {
        sampleCount: samples.length,
        withLevels: withLevels.length,
        byKind,
        examples: samples.slice(0, 10),
        actives
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
