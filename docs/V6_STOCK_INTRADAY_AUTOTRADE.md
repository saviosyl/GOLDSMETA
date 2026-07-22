# GoldMeta V6 — Stocks Intraday AutoTrade (Trading 212)

**Branch:** `cursor/goldmeta-v6-t212-intraday-autotrade-c2c2`  
**Base:** `cursor/goldmeta-v6-ig-autotrade-c2c2`  
**Separate from:** IG Gold CFD AutoTrade (PR #21)

## Purpose

Automatic **intraday** long-only stock/ETF trading on Trading 212 Invest:

- Rank eligible opportunities
- Buy automatically when Auto mode is active (no per-trade approval)
- Monitor GoldMeta-managed positions only
- Sell automatically on exit rules

Not weekly AutoInvest. Not CFD. Not short. Not leveraged.

## Modes

| Mode | Behaviour |
|------|-----------|
| OFF | Default. No scanning/orders |
| SHADOW | Full autonomous logic, hypothetical trades, no broker orders |
| T212_PAPER_AUTO | Architecture ready; **submission disabled** |
| T212_LIVE_AUTO | UI/architecture only; **hard-blocked** |

Flags (hard-coded false):

- `T212_PAPER_ORDER_SUBMISSION_ENABLED=false`
- `T212_LIVE_EXECUTION_FEATURE_FLAG=false`

## Architecture

```
TradingView webhook (secret token)
        │
        ▼
Auth (hash verify) → validate payload → atomic alert dedupe
        │
        ▼
Persist signal + durable job (Firestore) ──► HTTP 202
        │
        ▼
onDocumentCreated(jobs) → claim lease → process
        │
        ▼
rankingEngine → riskEngine → positionSizing → stateMachine
        │
        ▼
SHADOW records / PAPER+LIVE blocked by flags
```

Runtime storage: **`FirestoreStockIntradayStore`** (production/dev).  
`InMemoryStockIntradayStore` is for unit tests / explicit `STORAGE_BACKEND=memory` local only — never a silent production fallback.

### Firestore layout (`users/{userId}/stockIntraday/data/…`)

| Collection | Purpose |
|------------|---------|
| `settings/current` | Limits + universe |
| `riskState/current` | Mode, pause, kill-switch, daily counters |
| `restartGate/current` | Persistent restart / entries-paused gate |
| `signals/{alertId}` | Signal records |
| `alertIds/{alertId}` | Atomic alert dedupe keys |
| `intents/{intentId}` | Trade intents |
| `idempotency/{key}` | Intent idempotency + lease |
| `reservations/{intentId}` | Cash/exposure reservations |
| `positions/{positionId}` | GoldMeta-managed positions |
| `exitReservations/{positionId}` | Exit reservation locks |
| `reconciliation/{id}` | Pending/ambiguous reconcile records |
| `cooldowns/{symbol}` | Symbol cooldowns |
| `shadowTrades/{id}` | Hypothetical SHADOW fills |
| `activity/{id}` / `audit/{id}` | Activity + audit |
| `jobs/{jobId}` | Durable processing jobs |
| `webhookConnections/{id}` | Per-user webhook mirrors |

Root collections:

- `stockIntradayWebhookConnections/{connectionId}` — token hash → owner userId
- `stockIntradaySchedulerUsers/{userId}` — SHADOW scheduler registry

### Transaction boundaries

Firestore transactions (or in-memory mutex) protect:

- Alert deduplication (`reserveAlert`)
- Trade-intent idempotency (`reserveIntent`)
- Cash/exposure reservation (`reserveCash`)
- Daily trade-count / allocation increments
- Position slot reservation
- Exit reservation
- Job claim / complete / fail (+ dead-letter)

## TradingView webhook authentication

**Do not** use Firebase user session routes for TradingView.

1. Authenticated UI: `POST /v1/stock-intraday/webhook-connection` → returns `{ connectionId, secret, webhookPath }` once. Only **SHA-256 hash** is stored.
2. TradingView calls the dedicated endpoint with the secret (header preferred).

### Webhook URL (placeholders)

```
https://<CLOUD_FUNCTIONS_HOST>/webhooks/stock-intraday/<CONNECTION_ID>
```

Headers:

```
Content-Type: application/json
X-GoldMeta-Webhook-Token: <WEBHOOK_SECRET>
```

(Also accepts `Authorization: Bearer <WEBHOOK_SECRET>`.)

### JSON payload template (placeholders only)

```json
{
  "alertId": "{{timenow}}-AAPL-ENTRY",
  "strategyId": "momentum_breakout",
  "symbol": "AAPL",
  "exchange": "NASDAQ",
  "timeframe": "5m",
  "action": "ENTRY_LONG",
  "price": 180.25,
  "timestamp": "{{timenow}}",
  "barTime": "{{timenow}}",
  "barClosed": true,
  "volume": 1000000,
  "ema21": 179.1,
  "ema50": 175.0,
  "ema200": 160.0,
  "vwap": 179.5,
  "rsi": 58,
  "atr": 1.5,
  "relativeVolume": 1.8,
  "support": 178.0,
  "resistance": 182.0,
  "marketTrend": "BULL",
  "confidence": 85,
  "reasonCodes": ["BREAKOUT"]
}
```

Rejected: missing/invalid token, locked after repeated failures, Trading 212 credentials in payload, duplicate `alertId`, stale alerts.

## Durable asynchronous processing

Webhook / authenticated ACK path:

1. Authenticate (webhook) or Firebase session (UI test route only)
2. Validate basic payload
3. Atomically reject duplicate alert IDs
4. Store signal
5. Create durable `PROCESS_SIGNAL` job
6. Return **HTTP 202** quickly — **no** `void processQueuedSignal(...)`

Cloud Function `onStockIntradayJobCreated` claims a lease, increments attempts, processes, completes or fails → dead-letter after max attempts. Safe under duplicate trigger delivery.

## Automatic intraday engine

`stockIntradaySchedulerTick` (every 5 minutes, US/Eastern) enqueues:

- Scheduled watchlist scans (SHADOW only while Paper/Live submission disabled)
- Open-position monitoring (stops, TP, trailing/BE hooks, invalidation, max hold, EOD)
- Market-data health checks
- Broker reconciliation / market-close sweep job kinds

Cadence is coarse on purpose (provider rate limits + Firebase cost).

## Fail-closed market / broker inputs

No placeholders:

- Symbols must verify against Trading 212 instrument list; unavailable → **BLOCKED**
- No default `instrumentType = STOCK`
- `minutesToClose`, slippage, available cash, `minTradeQuantity` come from provider/broker; missing → **BLOCKED**

## Restart and reconciliation

On process boot (persisted `restartGate`, not a process-local `Set`):

- Keep new entries paused
- Load unresolved intents + broker pending/positions
- Match only GoldMeta-managed records
- Lock ambiguous symbols
- Resume **SHADOW** monitoring only after successful reconciliation
- Paper/Live execution remain disabled

## API routes

Authenticated (Firebase): `/v1/stock-intraday/*` — status, mode, limits, connect/paper, disconnect, emergency-stop, unlock, reconcile, shadow/scan, webhook-connection, signals/tradingview (UI/test)

Unauthenticated (webhook token): `/webhooks/stock-intraday/:connectionId`

## UI

- `/stocks-intraday` and `/ui-review/stocks-intraday`
- Nav: Gold CFD · Stocks Intraday

## Known limitations

- No market-data vendor selected yet → real Auto remains disabled outside mock/test
- T212 protective-stop behaviour for Live not certified → Live stays blocked
- Paper order submission intentionally false
- Scheduler requires registered SHADOW users (`stockIntradaySchedulerUsers`)
- T212 equity API field shapes may vary; HTTP adapter maps defensively and fails closed on missing min qty

## Safety confirmations

- Production unchanged  
- IG AutoTrade behaviour unchanged (PR #21 untouched)  
- No Paper order submitted  
- No Live order submitted  
- Both execution flags remain false  
