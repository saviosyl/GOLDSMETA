#!/usr/bin/env npx tsx
/**
 * Read-only production diagnosis of PLAN_15M opportunity blocking.
 * Never prints secrets. Never mutates Firestore / Auth / orders.
 *
 * Usage:
 *   npx tsx scripts/diagnosePlanOpportunityBlocking.ts
 */
import { resolveAlertRole } from "../src/services/decision/alertRole";
import { selectQuickTargetTp1 } from "../src/services/decision/quickTargetTp";
import { validateTradePlanGeometry } from "../src/services/decision/tradePlanGeometry";
import type { DecisionRecord } from "../src/models/types";

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "goldmeta-web";
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const HOURS_24 = 24 * 3600_000;
const DAYS_3 = 3 * 24 * 3600_000;
const DAYS_7 = 7 * 24 * 3600_000;

async function getAccessToken(): Promise<string> {
  if (!process.env.FIREBASE_TOKEN) {
    throw new Error("FIREBASE_TOKEN missing");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.FIREBASE_TOKEN,
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi"
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) {
    throw new Error(`FIREBASE_TOKEN exchange failed: ${json.error ?? res.status}`);
  }
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
    const fields = (o.mapValue as { fields?: Record<string, unknown> })?.fields ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(fields)) out[k] = decodeValue(val);
    return out;
  }
  if ("arrayValue" in o) {
    const values = (o.arrayValue as { values?: unknown[] })?.values ?? [];
    return values.map(decodeValue);
  }
  return null;
}

function decodeDoc(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decodeValue(v);
  return out;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function metaString(payload: Record<string, unknown>, key: string): string | null {
  const meta = payload.metadata as Record<string, unknown> | undefined;
  const v = meta?.[key] ?? payload[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function metaBool(payload: Record<string, unknown>, key: string): boolean | null {
  const meta = payload.metadata as Record<string, unknown> | undefined;
  const v = meta?.[key] ?? payload[key];
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function pos(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

type WindowStats = {
  plan15m: number;
  confirm5m: number;
  quote1m: number;
  legacyStrategy: number;
  other: number;
  scriptVersions: Record<string, number>;
  schemaVersions: Record<string, number>;
  alertRoles: Record<string, number>;
  chartMatchesRole: Record<string, number>;
  completePayloads: number;
  incompletePayloads: number;
  buyCandidates: number;
  sellCandidates: number;
  waitDecisions: number;
  hasEntryStopTp1: number;
  missingEntry: number;
  missingStop: number;
  missingTp1: number;
  missingTp2: number;
  currentValidator: {
    accepted: number;
    rejected: number;
    reasons: Record<string, number>;
  };
  proposedValidator: {
    accepted: number;
    rejected: number;
    reasons: Record<string, number>;
  };
  classificationChanges: number;
};

function emptyWindow(): WindowStats {
  return {
    plan15m: 0,
    confirm5m: 0,
    quote1m: 0,
    legacyStrategy: 0,
    other: 0,
    scriptVersions: {},
    schemaVersions: {},
    alertRoles: {},
    chartMatchesRole: {},
    completePayloads: 0,
    incompletePayloads: 0,
    buyCandidates: 0,
    sellCandidates: 0,
    waitDecisions: 0,
    hasEntryStopTp1: 0,
    missingEntry: 0,
    missingStop: 0,
    missingTp1: 0,
    missingTp2: 0,
    currentValidator: { accepted: 0, rejected: 0, reasons: {} },
    proposedValidator: { accepted: 0, rejected: 0, reasons: {} },
    classificationChanges: 0
  };
}

/** Proposed soft/hard split — mirrors intended fix for replay comparison. */
function validateProposed(input: Parameters<typeof validateTradePlanGeometry>[0]) {
  // Soft: do not treat LIVE_RANGE_ONLY / missing optional profile as fatal.
  // Soft: quickTargetOk=false does not erase valid Entry/Stop/TP1.
  const softMode =
    input.marketStructureMode === "LIVE_RANGE_ONLY" ||
    input.marketStructureMode === "UNAVAILABLE"
      ? null
      : input.marketStructureMode;
  const base = validateTradePlanGeometry({
    ...input,
    marketStructureMode: softMode,
    quickTargetOk: null
  });
  // Soft codes that current validator may still surface but proposed ignores for actionability
  const softCodes = new Set([
    "QUICK_TARGET_FAILED",
    "STRUCTURE_INCOMPLETE"
  ]);
  const hardReasons = base.reasonCodes.filter((c) => !softCodes.has(c));
  const hardFatal = hardReasons.length > 0;
  const hasLevels =
    base.normalized.direction != null &&
    base.normalized.entryPrice != null &&
    base.normalized.stop != null &&
    base.normalized.tp1 != null;
  const actionable = hasLevels && !hardFatal && base.normalized.direction != null;
  return {
    actionable,
    reasonCodes: hardFatal ? hardReasons : base.reasonCodes.filter((c) => softCodes.has(c)),
    primaryReason: hardFatal ? hardReasons[0] ?? null : null
  };
}

async function runQuery(
  token: string,
  structuredQuery: Record<string, unknown>
): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ structuredQuery })
    }
  );
  if (!res.ok) throw new Error(`runQuery failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ document?: { name: string; fields?: Record<string, unknown> } }>;
  return rows
    .filter((r) => r.document?.fields)
    .map((r) => ({
      __name: r.document!.name,
      ...decodeDoc(r.document!.fields)
    }));
}

async function listUserIds(token: string): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const url = new URL(`${FS}/userDirectory`);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list userDirectory failed: ${res.status}`);
    const json = (await res.json()) as {
      documents?: Array<{ name: string }>;
      nextPageToken?: string;
    };
    for (const doc of json.documents ?? []) {
      const id = doc.name.split("/").pop();
      if (id) ids.add(id);
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return [...ids];
}

function ingestEvent(stats: WindowStats, payload: Record<string, unknown>, decision: Record<string, unknown> | null) {
  const role = resolveAlertRole(payload as never);
  bump(stats.alertRoles, role ?? "UNKNOWN");
  if (role === "PLAN_15M") stats.plan15m += 1;
  else if (role === "CONFIRM_5M") stats.confirm5m += 1;
  else if (role === "QUOTE_1M") stats.quote1m += 1;
  else if (role === "LEGACY_STRATEGY") stats.legacyStrategy += 1;
  else stats.other += 1;

  const script = metaString(payload, "scriptVersion") ?? "unknown";
  const schema = metaString(payload, "schemaVersion") ?? String(payload.schemaVersion ?? "unknown");
  bump(stats.scriptVersions, script);
  bump(stats.schemaVersions, schema);
  const cmr = metaBool(payload, "chartMatchesRole");
  bump(stats.chartMatchesRole, cmr == null ? "null" : String(cmr));

  const isConfirmed = payload.isConfirmedBar === true;
  const entry =
    pos((payload.entry as { price?: number } | undefined)?.price) ??
    pos((payload.entry as { zoneLow?: number } | undefined)?.zoneLow) ??
    pos((decision?.entry as { price?: number } | undefined)?.price);
  const stop =
    pos((payload.stopLoss as { price?: number } | undefined)?.price) ??
    pos((decision?.stopLoss as { price?: number } | undefined)?.price);
  const tps =
    (payload.takeProfits as Array<{ label?: string; price?: number }> | undefined) ??
    (decision?.takeProfits as Array<{ label?: string; price?: number }> | undefined) ??
    [];
  const tp1 = pos(tps.find((t) => t.label === "TP1")?.price);
  const tp2 = pos(tps.find((t) => t.label === "TP2")?.price);
  const direction = String(
    payload.decision ?? decision?.decision ?? ""
  ).toUpperCase();

  const complete =
    isConfirmed &&
    (direction === "BUY" || direction === "SELL") &&
    entry != null &&
    stop != null &&
    tp1 != null;
  if (role === "PLAN_15M" || role === "LEGACY_STRATEGY") {
    if (complete) stats.completePayloads += 1;
    else stats.incompletePayloads += 1;
    if (direction === "BUY") stats.buyCandidates += 1;
    else if (direction === "SELL") stats.sellCandidates += 1;
    else stats.waitDecisions += 1;
    if (entry == null) stats.missingEntry += 1;
    if (stop == null) stats.missingStop += 1;
    if (tp1 == null) stats.missingTp1 += 1;
    if (tp2 == null) stats.missingTp2 += 1;
    if (entry != null && stop != null && tp1 != null) stats.hasEntryStopTp1 += 1;

    if (direction === "BUY" || direction === "SELL") {
      const fakeDecision = {
        decision: direction,
        entry: { price: entry, zoneLow: entry, zoneHigh: entry },
        stopLoss: { price: stop },
        takeProfits: tps,
        lastKnownPrice: pos(payload.ohlcv && (payload.ohlcv as { close?: number }).close),
        marketStructure: (payload.marketStructure ?? decision?.marketStructure) as never,
        higherTimeframeBias: decision?.higherTimeframeBias ?? null,
        invalidation: (payload.invalidation as string) ?? null
      } as unknown as DecisionRecord;

      const qt = selectQuickTargetTp1({
        direction: direction as "BUY" | "SELL",
        entry,
        stop,
        decision: fakeDecision,
        optionalIndicators: (payload.optionalIndicators as Record<string, unknown>) ?? null
      });

      const mode =
        pos((fakeDecision.marketStructure as { poc?: number } | null)?.poc) != null
          ? "COMPLETE"
          : "LIVE_RANGE_ONLY";

      const current = validateTradePlanGeometry({
        direction,
        entryPrice: entry,
        entryZoneLow: entry,
        entryZoneHigh: entry,
        stop,
        tp1,
        tp2,
        currentPrice: fakeDecision.lastKnownPrice,
        quickTargetOk: qt.rrOk,
        marketStructureMode: mode,
        confirmed: false
      });
      if (current.actionable) stats.currentValidator.accepted += 1;
      else {
        stats.currentValidator.rejected += 1;
        for (const r of current.reasonCodes) bump(stats.currentValidator.reasons, r);
        if (!current.reasonCodes.length) bump(stats.currentValidator.reasons, "UNKNOWN");
      }

      const proposed = validateProposed({
        direction,
        entryPrice: entry,
        entryZoneLow: entry,
        entryZoneHigh: entry,
        stop,
        tp1,
        tp2,
        currentPrice: fakeDecision.lastKnownPrice,
        quickTargetOk: qt.rrOk,
        marketStructureMode: mode,
        confirmed: false
      });
      if (proposed.actionable) stats.proposedValidator.accepted += 1;
      else {
        stats.proposedValidator.rejected += 1;
        for (const r of proposed.reasonCodes) bump(stats.proposedValidator.reasons, r);
        if (!proposed.reasonCodes.length) bump(stats.proposedValidator.reasons, "UNKNOWN");
      }
      if (current.actionable !== proposed.actionable) stats.classificationChanges += 1;
    }
  }
}

async function main(): Promise<void> {
  const token = await getAccessToken();
  const now = Date.now();
  const windows = {
    h24: { since: now - HOURS_24, stats: emptyWindow() },
    d3: { since: now - DAYS_3, stats: emptyWindow() },
    d7: { since: now - DAYS_7, stats: emptyWindow() }
  };

  const activePlans = await runQuery(token, {
    from: [{ collectionId: "sessionPlans", allDescendants: true }],
    limit: 200
  });

  const activeSummary = {
    totalActiveDocs: 0,
    lifecycle: {} as Record<string, number>,
    geometryReasons: {} as Record<string, number>,
    noValidPlan: 0,
    noTrade: 0,
    waitingEntry: 0,
    withLevels: 0,
    scriptVersions: {} as Record<string, number>,
    alertRoles: {} as Record<string, number>
  };

  for (const doc of activePlans) {
    const name = String(doc.__name ?? "");
    if (!name.endsWith("/sessionPlans/active")) continue;
    activeSummary.totalActiveDocs += 1;
    const life = String(doc.lifecycleState ?? "UNKNOWN");
    bump(activeSummary.lifecycle, life);
    if (life === "NO_VALID_PLAN") activeSummary.noValidPlan += 1;
    if (life === "NO_TRADE") activeSummary.noTrade += 1;
    if (life === "WAITING_FOR_ENTRY_ZONE" || life === "ARMED") activeSummary.waitingEntry += 1;
    if (doc.entry && doc.stopLoss) activeSummary.withLevels += 1;
    const reasons = (doc.geometryReasonCodes as string[] | undefined) ??
      ((doc.planQuality as { reasons?: string[] } | undefined)?.reasons ?? []);
    for (const r of reasons) bump(activeSummary.geometryReasons, r);
    bump(activeSummary.scriptVersions, String(doc.scriptVersion ?? "unknown"));
    bump(activeSummary.alertRoles, String(doc.alertRole ?? "unknown"));
  }

  const userIds = await listUserIds(token);
  let rawScanned = 0;
  let decisionsScanned = 0;

  for (const userId of userIds) {
    // Recent raw events (page)
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const url = new URL(`${FS}/users/${userId}/rawEvents`);
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("orderBy", "receivedAt desc");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 404) break;
      if (!res.ok) {
        // Fallback without orderBy if index missing
        const url2 = new URL(`${FS}/users/${userId}/rawEvents`);
        url2.searchParams.set("pageSize", "100");
        if (pageToken) url2.searchParams.set("pageToken", pageToken);
        const res2 = await fetch(url2.toString(), {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res2.ok) break;
        const json2 = (await res2.json()) as {
          documents?: Array<{ fields?: Record<string, unknown> }>;
          nextPageToken?: string;
        };
        for (const d of json2.documents ?? []) {
          const row = decodeDoc(d.fields);
          const receivedAt = Date.parse(String(row.receivedAt ?? row.createdAt ?? ""));
          if (!Number.isFinite(receivedAt)) continue;
          rawScanned += 1;
          const payload = (row.payload as Record<string, unknown>) ?? row;
          for (const w of Object.values(windows)) {
            if (receivedAt >= w.since) ingestEvent(w.stats, payload, null);
          }
        }
        pageToken = json2.nextPageToken;
        pages += 1;
        continue;
      }
      const json = (await res.json()) as {
        documents?: Array<{ fields?: Record<string, unknown> }>;
        nextPageToken?: string;
      };
      let oldestInPage = now;
      for (const d of json.documents ?? []) {
        const row = decodeDoc(d.fields);
        const receivedAt = Date.parse(String(row.receivedAt ?? row.createdAt ?? ""));
        if (!Number.isFinite(receivedAt)) continue;
        oldestInPage = Math.min(oldestInPage, receivedAt);
        rawScanned += 1;
        const payload = (row.payload as Record<string, unknown>) ?? row;
        for (const w of Object.values(windows)) {
          if (receivedAt >= w.since) ingestEvent(w.stats, payload, null);
        }
      }
      pageToken = json.nextPageToken;
      pages += 1;
      if (oldestInPage < windows.d7.since) pageToken = undefined;
    } while (pageToken && pages < 20);

    // Recent decisions for lifecycle / NO_VALID_PLAN counts
    const dUrl = new URL(`${FS}/users/${userId}/decisions`);
    dUrl.searchParams.set("pageSize", "50");
    const dRes = await fetch(dUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (dRes.ok) {
      const dJson = (await dRes.json()) as {
        documents?: Array<{ fields?: Record<string, unknown> }>;
      };
      for (const d of dJson.documents ?? []) {
        decodeDoc(d.fields);
        decisionsScanned += 1;
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    usersScanned: userIds.length,
    rawEventsScanned: rawScanned,
    decisionsScanned,
    activeSessionPlans: activeSummary,
    windows: {
      last24h: windows.h24.stats,
      last3d: windows.d3.stats,
      last7d: windows.d7.stats
    }
  };

  const outPath = "/tmp/plan-opportunity-blocking.json";
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8")
  );
  console.log(JSON.stringify(report, null, 2));
  console.error(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
