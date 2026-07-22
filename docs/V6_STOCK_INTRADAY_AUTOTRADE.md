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

## Shared deployment generation

All Stock Intraday Cloud Run / Functions services (API, Firestore job trigger,
scheduler, retry tick) **must** share one explicit value:

```
STOCK_INTRADAY_DEPLOYMENT_GENERATION=<same-string>
```

`K_REVISION` is **never** used as a fallback — services may have different
revisions. Missing the explicit variable fails closed outside test / explicit
local development (`STORAGE_BACKEND=memory` or
`STOCK_INTRADAY_ALLOW_LOCAL_GENERATION=1`).

A new function instance with the same generation must not re-pause an already
reconciled SHADOW engine.

## Architecture

```
TradingView webhook (routing id in path)
        │
        ▼
Trusted-edge source verify (TV cert CN / allowlisted IP)
        │  (if unavailable → store/analyse only; no auto entry)
        ▼
Hash routing id → Firestore lookup → enabled/expiry/rate-limit
        │
        ▼
Validate payload → atomic alert dedupe → durable job → HTTP 202
        │
        ▼
onDocumentCreated(jobs) → claim lease → process
        │
        ▼
Internal market-data scan + rankingEngine + riskEngine (independent confirm)
        │
        ▼
SHADOW records / PAPER pending reservation / LIVE blocked by flags
```

Runtime storage: **`FirestoreStockIntradayStore`**.  
`InMemoryStockIntradayStore` is for unit tests / explicit `STORAGE_BACKEND=memory`
local only — never a silent production fallback. Multi-instance safety is covered
by Firestore Emulator integration tests, not InMemory alone.

### Firestore layout (`users/{userId}/stockIntraday/data/…`)

| Collection | Purpose |
|------------|---------|
| `settings/current` | Limits + universe |
| `riskState/current` | Mode, pause, kill-switch, daily counters |
| `restartGate/current` | Persistent restart / entries-paused gate |
| `signals/{alertId}` | Signal records |
| `alertIds/{alertId}` | Atomic alert dedupe keys |
| `intents/{intentId}` | Trade intents + entryReservationState |
| `idempotency/{key}` | Intent idempotency + lease |
| `reservations/{intentId}` | Cash/exposure reservations |
| `positions/{positionId}` | GoldMeta-managed positions |
| `exitReservations/{positionId}` | Exit reservation locks |
| `reconciliation/{id}` | Pending/ambiguous reconcile records |
| `cooldowns/{symbol}` | Symbol / loss cooldowns |
| `shadowTrades/{id}` | Hypothetical SHADOW fills with full P/L |
| `activity/{id}` / `audit/{id}` | Activity + audit (no raw routing ids) |
| `jobs/{jobId}` | Durable processing jobs |
| `webhookConnections/{routingIdHash}` | Per-user webhook mirrors (hashed keys) |
| `dashboard/current` | Persisted dashboard snapshot |

Root collections:

- `stockIntradayWebhookConnections/{routingIdHash}` — hashed routing id → owner
- `stockIntradaySchedulerUsers/{userId}` — SHADOW scheduler registry
- `stockIntradayRetryIndex` — composite index `(state ASC, nextAttemptAt ASC)`

## TradingView webhook security

TradingView is an **untrusted** signal source.

Official guidance: do **not** put credentials in the webhook URL or message.
TradingView documents:

- Client certificate: Subject O=`TradingView, Inc.`, CN=`webhook-server@tradingview.com`
- Source IP allowlist: `52.89.214.238`, `34.212.75.30`, `54.218.53.128`, `52.32.178.7`

### Firebase Functions limitation

Firebase Functions Gen2 (Cloud Run) does **not** expose TradingView client
certificates to application code. Reliable mTLS / peer-IP attestation requires a
trusted edge (custom load balancer / Cloud Armor) in front. Client-supplied
`X-Forwarded-For` is **never** trusted.

When reliable verification is unavailable:

- Signals may be stored and analysed
- They must **not** independently authorize automatic entry
- An internal market-data scan and all GoldMeta risk checks must independently
  confirm the opportunity (scheduled SHADOW scan path)

### Connection lifecycle

1. Authenticated UI: `POST /v1/stock-intraday/webhook-connection`
2. Configure TradingView alert URL:

```
https://<CLOUD_FUNCTIONS_HOST>/webhooks/stock-intraday/<CONNECTION_ID>
```

`<CONNECTION_ID>` is a **non-secret routing identifier** only. Lookup hashes the
path value before Firestore get. Mirrors use the hash as the document id.

3. Features: enabled/disabled, expiry, last-used, per-connection rate limit,
   authenticated revoke (`…/revoke`), rotation (`…/rotate`), constant-time hash
   compare. Unused `secretHash` / failure-lock fields removed.
4. Audit logs store hash prefixes only — never raw routing/capability values.
5. Alert message = JSON signal fields only — no passwords or T212 secrets.

## Paper pending entry reservations

`reserveEntryAtomically` reserves capacity before a broker fill:

- Pending position slot, daily trade slot, daily allocation, portfolio/symbol
  exposure, cash, idempotency key, intent

States: `RESERVED` | `SUBMITTED` | `FILLED` | `CANCELLED` | `RELEASED` | `UNKNOWN`

Pending Paper reservations count against future concurrent entries. Cancellation
releases slots/cash/exposure and reverses daily counters. Fill converts to a
GoldMeta-managed position without double-counting. Paper submission remains
disabled in this delivery.

## SHADOW exit accounting

Every SHADOW exit persists: exit timestamp, validated exit price, entry price,
quantity, gross P/L, estimated spread/slippage, estimated FX impact, net realised
P/L, exit reason, holding duration, strategy, confidence at entry.

Atomic updates: `dailyRealisedPnl`, `losingTradesToday`, `dailyUnrealisedPnl`,
intent `CLOSED` + `exitReason`, position removal, cash release, symbol cooldown,
loss cooldown when negative. Enforces `maxLosingTradesPerDay`, `maxDailyLoss`,
`perSymbolCooldownMinutes`, `cooldownAfterLossMinutes`. Loss limits lock/pause
SHADOW and preserve audit information.

## Exit capabilities (SHADOW — implemented)

- Hard stop / take profit
- Trailing stop
- Break-even movement
- VWAP loss
- Indicator reversal
- Trend invalidation
- Maximum holding time
- End-of-day exit

## Durable asynchronous processing

Webhook / authenticated ACK path:

1. Authenticate (webhook routing + optional trusted-edge source verify) or Firebase session (UI test)
2. Validate basic payload
3. Atomically reject duplicate alert IDs
4. Store signal
5. Create durable `PROCESS_SIGNAL` job (`authorizesAutomaticEntry` flag)
6. Return **HTTP 202** quickly

## Automatic intraday engine

`stockIntradaySchedulerTick` enqueues monitor + scan + health jobs. Cadence is
coarse on purpose (provider rate limits + Firebase cost).

## Safety confirmations

- Production unchanged  
- IG AutoTrade behaviour unchanged (PR #21 untouched)  
- No Paper order submitted  
- No Live order submitted  
- Both execution flags remain false  
