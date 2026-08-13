# Micro Edge — shadow research + market data + read-only activation

**MICRO EDGE IS READ-ONLY. NO BROKER ORDER PATH EXISTS.**

## Stack

| PR / branch | Role |
|-------------|------|
| production `cursor/production-connection` | Core Demo Auto (untouched by Micro) |
| #113 `cursor/micro-edge-v1` | Prediction/research scaffold |
| #114 `cursor/micro-edge-market-data-v1` | Read-only market-data protocol |
| activation `cursor/micro-edge-readonly-activation-v1` | OAuth / token vault / collector / historical quotes |

## Namespace

`microEdge/shadow-v1` (predictions/outcomes)  
`microEdge/shadow-v1/marketData/**` (raw bars / live quote samples / boundary quotes / checkpoints)  
`microEdge/shadow-v1/private/oauth/**` (encrypted tokens — Admin only)  
`microEdge/shadow-v1/runtime/**` (collector heartbeat)

## Connection states

| State | Meaning |
|-------|---------|
| `INTERFACE_READY` | Methods/types exist |
| `MOCK_SEEDED` | In-memory test injection only |
| `LIVE_CONNECTED` | Authenticated OpenAPI + XAUUSD + fresh Bid/Ask + M1 |
| `LIVE_NOT_CONNECTED` | Default until genuine session is up |
| `FEATURE_GATED` | DOM / live trendbar subs |

## Credentials

Prefer interactive OAuth (`scope=accounts`) → encrypted Micro vault.

```
MICRO_CTRADER_CLIENT_ID
MICRO_CTRADER_CLIENT_SECRET
MICRO_CTRADER_REDIRECT_URI
MICRO_CTRADER_ENVIRONMENT=DEMO
MICRO_CTRADER_ + TOKEN_ENCRYPTION_KEY
MICRO_QUOTE_SAMPLE_INTERVAL_MS=5000
MICRO_HISTORICAL_QUOTE_BACKFILL_DAYS=30
MICRO_BROKER_EXECUTION_ENABLED=false
```

Do **not** reuse Core `CTRADER_ACCESS_TOKEN` / `CTRADER_REFRESH_TOKEN`.  
Do **not** import Core `services/broker/ctrader`.

See `ACTIVATION.md` for collector runtime and redirect URI registration.

## CLI

```bash
npm run micro-edge:backfill-bars
npm run micro-edge:backfill-boundary-quotes
npm run micro-edge:diagnostics
npm run micro-edge:collector   # not deployed by this PR
```

## Model

`DATA COLLECTION / NOT TRAINED ON REAL DATA` — no live probabilities until a later training PR.
