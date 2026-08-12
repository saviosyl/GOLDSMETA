# Micro Edge — shadow research + market data

**MICRO EDGE MARKET DATA V1 IS READ-ONLY. NO BROKER ORDER PATH EXISTS.**

## Namespace

`microEdge/shadow-v1` (predictions/outcomes)  
`microEdge/shadow-v1/marketData/**` (raw bars/quotes/checkpoints)

## Market data (V1.1)

| State | Meaning |
|-------|---------|
| `INTERFACE_READY` | Methods/types exist |
| `MOCK_SEEDED` | In-memory test injection only |
| `LIVE_CONNECTED` | Authenticated OpenAPI + XAUUSD + fresh Bid/Ask |
| `LIVE_NOT_CONNECTED` | Default until genuine session is up |
| `FEATURE_GATED` | Historical ticks / DOM / live trendbar subs |

### Credentials (Micro-specific)

```
MICRO_CTRADER_CLIENT_ID
MICRO_CTRADER_CLIENT_SECRET
MICRO_CTRADER_ACCESS_TOKEN
MICRO_CTRADER_REFRESH_TOKEN
MICRO_CTRADER_ACCOUNT_ID
MICRO_CTRADER_ENVIRONMENT=DEMO|LIVE
MICRO_CTRADER_REDIRECT_URI   # optional — for later OAuth helper
MICRO_QUOTE_SAMPLE_INTERVAL_MS=5000
```

Prefer **scope=accounts** view-only tokens. Trading scope is not required.

Do **not** import Core `services/broker/ctrader`.

### CLI

```bash
npm run micro-edge:backfill
```

### Bar conflict policy

Deterministic id `SYMBOL_TF_closeTimeMs`. Identical re-upsert → skip. Changed OHLC → **conflict** (keep original, audit conflict). No silent overwrite.

### Retention

Quotes: recommend 30 days (helper only; no destructive prod cleanup in this PR).  
Bars: long-lived research retention.

## Versions

- Feature: `features-v1.0.0`
- Model: `logistic-champion-v1.0.0` — **NOT TRAINED ON LIVE DATA**
- Label / cost: see config.ts
