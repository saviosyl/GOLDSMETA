#!/usr/bin/env npx tsx
/**
 * Read-only inspection of Pepperstone connection + live quote store.
 * Never prints ciphertext, tokens, or secrets.
 */
const PROJECT_ID = process.env.GCLOUD_PROJECT || "goldmeta-web";
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function getAccessToken(): Promise<string> {
  if (!process.env.FIREBASE_TOKEN) throw new Error("FIREBASE_TOKEN missing");
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
    return ((o.arrayValue as { values?: unknown[] }).values ?? []).map(decodeValue);
  }
  return null;
}

async function runQuery(token: string, collectionId: string) {
  const res = await fetch(`${FS}:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants: true }],
        limit: 30
      }
    })
  });
  const rows = (await res.json()) as Array<{
    document?: { name: string; fields?: Record<string, unknown> };
  }>;
  if (!Array.isArray(rows)) {
    console.log(collectionId, "error", rows);
    return [] as Array<{ name: string; fields: Record<string, unknown> }>;
  }
  return rows
    .filter((r) => r.document)
    .map((r) => {
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.document!.fields ?? {})) {
        fields[k] = decodeValue(v);
      }
      return { name: r.document!.name, fields };
    });
}

async function main() {
  const token = await getAccessToken();
  const connections = await runQuery(token, "ctraderConnection");
  const quotes = await runQuery(token, "ctraderLiveQuote");
  console.log("=== ctraderConnection count", connections.length);
  for (const c of connections) {
    const f = c.fields;
    const tokens = f.tokens as Record<string, unknown> | null;
    console.log(
      JSON.stringify(
        {
          path: c.name.replace(/^.*\/documents\//, ""),
          ownerUid: f.ownerUid ?? null,
          environment: f.environment ?? null,
          selectedAccountMasked: f.selectedAccountMasked ?? null,
          selectedAccountIsLive: f.selectedAccountIsLive ?? null,
          brokerName: f.brokerName ?? null,
          brokerConfirmedPepperstone: f.brokerConfirmedPepperstone ?? null,
          currency: f.currency ?? null,
          symbolId: f.symbolId ?? null,
          symbolName: f.symbolName ?? null,
          symbolDigits: f.symbolDigits ?? null,
          symbolPipPosition: f.symbolPipPosition ?? null,
          lastQuoteAt: f.lastQuoteAt ?? null,
          lastSyncAt: f.lastSyncAt ?? null,
          disconnectedAt: f.disconnectedAt ?? null,
          hasEncryptedTokens: Boolean(tokens && tokens.ciphertext)
        },
        null,
        2
      )
    );
  }
  console.log("=== ctraderLiveQuote count", quotes.length);
  for (const q of quotes) {
    const f = q.fields;
    if (f.sequence != null && f.bid == null) {
      console.log(
        JSON.stringify(
          {
            path: q.name.replace(/^.*\/documents\//, ""),
            metaSequence: f.sequence
          },
          null,
          2
        )
      );
      continue;
    }
    console.log(
      JSON.stringify(
        {
          path: q.name.replace(/^.*\/documents\//, ""),
          symbolId: f.symbolId,
          symbolName: f.symbolName,
          digits: f.digits,
          pipPosition: f.pipPosition,
          bid: f.bid,
          ask: f.ask,
          mid: f.mid,
          freshness: f.freshness,
          quoteSequence: f.quoteSequence,
          brokerTimestamp: f.brokerTimestamp,
          receivedAt: f.receivedAt,
          environment: f.environment,
          marketStatus: f.marketStatus
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
