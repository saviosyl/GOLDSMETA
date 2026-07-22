# GoldMeta V6.0 — IG AutoTrade Preview (architecture report)

**Branch:** `cursor/goldmeta-v6-ig-autotrade-c2c2`  
**Base commit (approved V5.4.3 production tree):** `4621156c146d6857205ea2f9d3256b6348227d89`  
**Release posture:** preview only — do not merge, do not promote, do not enable real IG trading.

## Safety confirmations

| Check | Status |
|-------|--------|
| Default mode | **OFF** |
| `LIVE_EXECUTION_FEATURE_FLAG` | **false** (hard-coded) |
| Real IG orders in automated tests | **None** (FakeIgBrokerAdapter only) |
| Production V5.4.3 | Untouched — remains on `4621156` assets |
| Browser can mark APPROVED/ACCEPTED/OPEN/CLOSED | **No** — server Admin/service only |
| IG secrets in React / Vite env / Firestore client docs | **No** |

## Stage coverage

### Stage A — Foundation & UI
- AutoTrade nav entry (desktop More + mobile More)
- Premium AutoTrade Control Centre (`AutoTradePage`)
- Risk settings, daily/weekly budget, activity log, broker connection, open positions
- Emergency STOP (sticky/fixed, desktop + mobile)
- Live activation UI with typed `ENABLE LIVE AUTOTRADE`
- Mobile-responsive layout (scoped `.gm-autotrade-*` CSS only)

### Stage B — Backend & broker abstraction
- `AutoTradeBrokerAdapter` interface
- `FakeIgBrokerAdapter` (all automated execution tests)
- `IgBrokerAdapter` scaffolding (demo + live hosts, dry-run default)
- In-memory store mirroring Firestore collections
- Trade intent state machine
- Risk engine, position sizing, eligibility
- Idempotency deal reference, duplicate protection, user mutex
- Reconciliation path on uncertain broker response → lock
- Audit + activity logging

### Stage C — IG demo integration (scaffolded)
- Demo base URL isolation (`demo-api.ig.com`)
- Session / accounts / Spot Gold market / positions / OTC order / confirms / close / amend
- Dry-run until server secrets configured; tests never call real IG

### Stage D — Live-capable scaffolding
- Live base URL (`api.ig.com`) separated from DEMO
- Typed confirmation + risk/account acknowledgements
- Feature flag blocks LIVE mode and LIVE order placement
- Restart policy: LIVE mode does not auto-restore

## Backend Functions / HTTP routes added

Mounted on existing Firebase HTTPS `api` function (Express):

| Method | Path |
|--------|------|
| GET | `/v1/autotrade/status` |
| PATCH | `/v1/autotrade/limits` |
| POST | `/v1/autotrade/mode` |
| POST | `/v1/autotrade/connect` |
| POST | `/v1/autotrade/emergency-stop` |
| POST | `/v1/autotrade/unlock` |
| POST | `/v1/autotrade/evaluate` |

## Firestore collections & rules

Under `users/{userId}/` (owner **read**, client **write: false**):

- `brokerConnections`
- `brokerSettings`
- `autoTradeRiskState`
- `tradeIntents`
- `brokerExecutions`
- `brokerPositions`
- `brokerEvents`
- `autoTradeAudit`
- `autoTradeLocks`

## Broker adapter report

| Adapter | Role |
|---------|------|
| `FakeIgBrokerAdapter` | Deterministic scenarios for Vitest (happy, reject, timeout, stale, closed, spread, min size, stop reject, session fail) |
| `IgBrokerAdapter` | Real REST scaffolding; dry-run by default; LIVE submits throw while feature flag false |

## Risk-engine test matrix (covered)

- Successful demo trade
- Duplicate decision / idempotency
- Concurrent evaluate serialization
- Timeout after accept → lock / reconcile
- Rejected order
- Stop rejected → lock
- Minimum size exceeds risk (message format)
- Stale quote / closed market / excessive spread
- Daily / weekly / consecutive loss blocks
- Emergency STOP
- DEMO/LIVE endpoint separation
- Secret redaction
- LIVE feature flag blocks activation
- Fake adapter only (no real order)

## First-pilot defaults encoded

Mode OFF; €5 / trade; €100 margin; €10 daily; €30 weekly; 1 open; 1 trade/day; 2 consecutive losses; 60 min cooldown; score ≥ 85; R:R ≥ 1:2; guaranteed stop required; London / New York / overlap.

## Screenshots

See `docs/v6-autotrade/` and `/opt/cursor/artifacts/v6-autotrade-screenshots/`.

## Test counts (this tip)

Recorded after implementation; see delivery summary for exact totals.
