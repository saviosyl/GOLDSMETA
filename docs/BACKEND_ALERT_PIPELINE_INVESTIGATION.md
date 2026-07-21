# Backend alert pipeline investigation — 2026-07-21

**Scope:** Why GoldMeta dashboard still shows the ~12:46 TEST decision after TradingView alerts at 13:00 / 13:15.  
**Out of scope:** TradingView chart/Pine (user confirmed TV side working).

**User:** `iuayfBpUkZYEAlYlsTFxulSC4Ye2`  
**Webhook:** `2HBnvhqE6XQPJF4roWCQUx6E`  
**Times below are UTC** (12:46 local BST ≈ 11:46 UTC; 13:00/13:15 BST ≈ 12:00/12:15 UTC).

---

## Executive result

| Step | Result |
| --- | --- |
| 1. Webhook endpoint `/webhooks/tradingview/:id` | **No POST** for 13:00 / 13:15. Last TradingView-path activity today at **10:00 UTC** (agent validation). |
| 1b. What created the 12:46 decision | **`POST /api/v1/tradingview/test`** (GoldMeta app test button on iPhone), **HTTP 202**, not TradingView. |
| 2. Job runner | **Not Cloud Tasks.** Firestore trigger `processProcessingJob` on `processingJobs/{jobId}`. Job **queued + COMPLETED**. |
| 3. Firestore decision | **Yes:** `a6742b4f8cb79367e33452a4` (latest by `generatedAt`). |
| 4. Decision engine | **WAIT** — incomplete test payload (`MISSING_VOLUME_PROFILE`, `MISSING_CONFIRMATION`, `INCOMPLETE_DATA`). |
| 5. Dashboard API | **Reading latest correctly.** Repeated `GET /v1/decisions/latest` → **200/304**. No caching bug hiding a newer LIVE decision — **none exists**. |

---

## 1. Cloud Function webhook endpoint

### All `api` POSTs today (relevant)

| UTC time | Status | Path | Client |
| --- | --- | --- | --- |
| 11:45:55 | **202** | `/api/v1/tradingview/test` | iPhone Safari (GoldMeta app) |
| 10:00:09 | 202 | `/api/webhooks/tradingview/2HBnvhq…` | Python-urllib (prior validation) |
| 10:00:08 | 202 | `/api/webhooks/tradingview/2HBnvhq…` | Python-urllib |
| 09:25 / 09:23 / 08:51 / … | 202 | `/api/v1/tradingview/test` | iPhone |

**No exceptions** on the 11:45:55 test call.  
**No HTTP request** to `/webhooks/tradingview/…` at ~12:00 or ~12:15 UTC.

`webhookConnections/2HBnvhq…`.lastAlertAt = `2026-07-21T11:45:55.935Z` (updated by the in-app test enqueue path, which shares the same webhook id).

---

## 2. Job processing (`processProcessingJob`)

Architecture reminder (`backend/src/index.ts`):

```ts
export const processProcessingJob = onDocumentCreated(
  { document: "processingJobs/{jobId}", region: … },
  async (event) => { await processJob(event.params.jobId); }
);
```

This is a **Firestore document trigger**, not Google Cloud Tasks.

### Job for the 12:46 decision

```json
{
  "jobId": "167e48c6-0e4e-47a1-a0ed-3ae82ce9d274",
  "eventId": "78858d7943b906cd9746ff12410ad4bbe80d7bc5584cf21e4bc4710c774be2ad",
  "webhookId": "2HBnvhqE6XQPJF4roWCQUx6E",
  "state": "COMPLETED",
  "environment": "TEST",
  "isTestDecision": true,
  "createdAt": "2026-07-21T11:45:56.002Z",
  "startedAt": "2026-07-21T11:46:01.843Z",
  "completedAt": "2026-07-21T11:46:02.650Z",
  "decisionId": "a6742b4f8cb79367e33452a4",
  "errorMessage": null
}
```

### `processProcessingJob` logs (11:45–11:46 UTC)

- Instance autoscale start ~11:45:56  
- Trigger HTTP 200  
- Pipeline completed; push skipped (`VAPID keys not configured`; no FCM devices)  
- No failure / exception

---

## 3. Firestore

### Latest decision (what Dashboard should show)

| Field | Value |
| --- | --- |
| **decisionId** | `a6742b4f8cb79367e33452a4` |
| decision | **WAIT** |
| environment / isTestDecision | **TEST** / **true** |
| generatedAt | `2026-07-21T11:46:02.374Z` |
| barTime | `2026-07-21T11:45:55.723Z` |
| confidence | 19 (LOW) |
| reasonCodes | `MISSING_CONFIRMATION`, `MISSING_VOLUME_PROFILE`, `INCOMPLETE_DATA` |
| missingInputs | `volumeProfile`, `confirmationCandle` |
| lifecycleState | `INCOMPLETE` |
| dataQuality | `PARTIAL` |
| metadata on raw event | `source: "goldmeta-api-test"` |

### Prior BUY TEST (10:00 UTC) — still in history, not latest

| Field | Value |
| --- | --- |
| decisionId | `ec2c600fde41d0a2679cea86` |
| decision | BUY |
| generatedAt | `2026-07-21T10:00:11.149Z` |

`listDecisions` / `latestDecision` order by `generatedAt desc` → latest is **a6742b4f…**, not the 10:00 BUY.

---

## 4. Decision engine

Raw event payload from the in-app test (`buildTestPayload` in `routes/tradingview.ts`):

- `eventType: "TEST"`
- `sessionVolumeProfile: null`, `levels: null`
- `confirmationCandle: null`
- `trend: NEUTRAL / strength 50 / components []`
- synthetic OHLCV only

Hard guards correctly forced **WAIT** with incomplete-data reasons. **Not aborted**; decision document was written.

---

## 5. Dashboard API

- Client: `GET /v1/decisions/latest` → `store.latestDecision(userId)`.
- Logs 11:40–12:30 UTC: many successful reads (`200` then `304` Not Modified) — expected when the latest document is unchanged.
- Offline `localStorage` cache is **fallback on error only**; live loads overwrite cache. **Not** the reason the 12:46 TEST remains visible.
- Conclusion: Dashboard is correctly showing the newest Firestore decision. There is **no newer decision** from 13:00 / 13:15 because those webhooks **never hit this backend**.

---

## Final processing result (12:46 local / 11:46 UTC)

```text
Source:        POST /api/v1/tradingview/test  →  HTTP 202
Raw event:     78858d7943b906cd9746ff12410ad4bbe80d7bc5584cf21e4bc4710c774be2ad
Job:           167e48c6-0e4e-47a1-a0ed-3ae82ce9d274  →  COMPLETED
Decision ID:   a6742b4f8cb79367e33452a4
Result:        WAIT (TEST, incomplete synthetic payload)
```

## Gap vs TradingView 13:00 / 13:15

Backend Cloud Logging shows **zero** `POST /webhooks/tradingview/…` in the window corresponding to those alert times. Pipeline idle after 11:46 UTC aside from dashboard GETs.

Next check on the alert configuration (outside this backend report): webhook URL delivery status in TradingView Alert Log, correct URL  
`https://us-central1-goldmeta-web.cloudfunctions.net/api/webhooks/tradingview/2HBnvhqE6XQPJF4roWCQUx6E`, and that the alert is not only firing notifications without webhook delivery.
