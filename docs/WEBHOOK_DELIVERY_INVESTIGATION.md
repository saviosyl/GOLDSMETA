# Webhook delivery investigation — TradingView POSTs after URL save

**Date:** 2026-07-21  
**User:** `iuayfBpUkZYEAlYlsTFxulSC4Ye2`  
**Active webhook:** `2HBnvhqE6XQPJF4roWCQUx6E`  
**Scope:** Delivery only (not Pine / dashboard UI).

---

## 1. Did Firebase receive POSTs after the webhook URL was saved?

**Yes.** Cloud Logging shows TradingView POSTs to the live Cloud Function:

| UTC time | Status | Latency | Request size | User-Agent |
| --- | --- | --- | --- | --- |
| 13:00:00.464 | **400** | 38 ms | 2797 | `TradingView Webhook` |
| 13:15:00.566 | **400** | 8 ms | 2797 | `TradingView Webhook` |
| 13:15:00.770 | **400** | 7 ms | 2800 | `TradingView Webhook` |
| 13:30:00.291 | **400** | 11 ms | 2806 | `TradingView Webhook` |
| 13:30:00.295 | **400** | 12 ms | 2806 | `TradingView Webhook` |

URL on every request:

```text
https://us-central1-goldmeta-web.cloudfunctions.net/api/webhooks/tradingview/2HBnvhqE6XQPJF4roWCQUx6E
```

Remote IP `52.32.178.7` (TradingView). Duplicate POSTs at :15 / :30 are consistent with TradingView retrying on non-2xx.

---

## 2. If yes — status, body, processing

| Item | Finding |
| --- | --- |
| HTTP status | **400** (not 401/404/5xx) |
| Request body | Present (~2.8 KB). Cloud Logging does **not** store the body by default; app previously did not log validation details. |
| Response | ~261 bytes total (headers + body) — matches a small JSON error such as `INVALID_PAYLOAD` / `BAD_REQUEST` / `STALE_TIMESTAMP` |
| Processing | **None.** No new `rawEvents` / `processingJobs` / decisions for 13:00–13:30. `lastAlertAt` was **not** updated by these POSTs (only by later in-app `/v1/tradingview/test` at 13:07). |

Validation order in `validateWebhookPayload`:

1. Zod schema → **400 `INVALID_PAYLOAD`**
2. `sentAt` skew (5 min) → **400 `STALE_TIMESTAMP`**
3. Webhook id lookup → 404
4. Body secret mismatch → **401 `INVALID_SECRET`**

Observed **400** + **~10 ms** latency ⇒ failure at step 1 or 2 (before / without meaningful Firestore work). Not “TradingView never reached us.”

---

## 3. If no — why not reaching?

**N/A.** TradingView **is** reaching the endpoint. Delivery path works; the function **rejects** the payload.

---

## 4. Does the configured URL match the active webhook id?

**Yes — exact match.**

| Check | Value |
| --- | --- |
| Firestore `webhookConnections` ACTIVE for user | `2HBnvhqE6XQPJF4roWCQUx6E` |
| Status | `ACTIVE` (`LZhO8P08…` is `REVOKED`) |
| Path id on all TV POSTs | `2HBnvhqE6XQPJF4roWCQUx6E` |
| Expected public URL | `https://us-central1-goldmeta-web.cloudfunctions.net/api/webhooks/tradingview/2HBnvhqE6XQPJF4roWCQUx6E` |

Wrong webhook id would be **404**, not 400.

---

## 5. Does `symbolOk=false` reject or downgrade?

Backend has **no `symbolOk` field** in validation. That flag is Pine `metadata` only (`z.record` — ignored for accept/reject).

What the backend **does** enforce:

```ts
symbol: z.literal("XAUUSD")
```

| Case | Result |
| --- | --- |
| `"symbol": "XAUUSD"` | Passes symbol check |
| Any other string (e.g. broker ticker when Pine falls back) | **400 `INVALID_PAYLOAD`** — **reject**, not WAIT/downgrade |
| `metadata.symbolOk: false` with `symbol: "XAUUSD"` | Still accepted at webhook layer |

So `symbolOk=false` alone does **not** reject. A non-`XAUUSD` **`symbol`** value does.

---

## Root cause (delivery)

TradingView successfully POSTs a ~2.8 KB body to the correct ACTIVE webhook URL; Firebase responds **400** and never enqueues a job. Dashboard therefore cannot show those bar-close alerts.

Likely reject class: **schema / parse / skew** (`INVALID_PAYLOAD`, `BAD_REQUEST`, or `STALE_TIMESTAMP`). Exact Zod path was not previously logged.

Secondary landmine (after schema would pass): connection has a non-null `secret`, while default Pine emits `"webhookSecret": null`. Old code treated that as **401 `INVALID_SECRET`**. That did **not** cause today’s 400s, but would block the next successful schema parse.

---

## Fixes shipped on branch `cursor/webhook-delivery-400-c2c2`

1. Accept `text/plain` JSON bodies (TradingView uses this when the message is not detected as JSON).
2. Normalize string JSON bodies before Zod.
3. Log Zod issue paths on `INVALID_PAYLOAD`; return `error.details` in the 400 JSON.
4. Enforce body secret only when the payload provides a non-null `webhookSecret` (URL webhook id remains primary auth).
