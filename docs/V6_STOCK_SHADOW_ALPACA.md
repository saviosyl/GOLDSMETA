# GoldMeta V6 — Stock Intraday SHADOW Pilot (Alpaca IEX)

**Status:** Engineering / unattended SHADOW validation only  
**Feed label:** `ALPACA IEX — SHADOW VALIDATION ONLY`  
**Not full US market coverage.** IEX-only data must never be described as SIP/full-tape coverage.

## Safety invariants

- Trading 212 remains **read-only**
- `T212_PAPER_ORDER_SUBMISSION_ENABLED=false`
- `T212_LIVE_EXECUTION_FEATURE_FLAG=false`
- No Paper or Live broker orders
- No production deploy in this milestone
- Credentials are **server-side only** (never browser, Firestore client docs, logs, errors, analytics)

## Architecture

```
Scheduled CF ticks
  ├─ watchlist scan (~5 min)
  ├─ open-position monitor (~1 min)
  └─ end-of-day sweep
        │
        ▼
StockIntradayService
        │
        ├─ MarketDataProvider ← AlpacaMarketDataProvider (REST)
        │     quotes / bars / locally computed indicators
        │
        ├─ T212BrokerAdapter (Paper read-only validation)
        │
        └─ Firestore namespace (shadow decisions + positions)
```

`MarketDataProvider` remains the sole market-data port.  
`AlpacaMarketDataProvider` is the first real implementation.  
Tests use `MockMarketDataProvider`. Preferring Alpaca without credentials **fails closed** — never silent mock fallback.

A future `MarketDataStreamConsumer` exists as a design stub only. This delivery does **not** open a permanent WebSocket inside Cloud Functions.

## Alpaca API endpoints used

Base: `https://data.alpaca.markets` (override via `ALPACA_MARKET_DATA_BASE_URL`)

| Capability | Endpoint |
|---|---|
| Latest quote | `GET /v2/stocks/{symbol}/quotes/latest?feed=iex` |
| Latest trade | `GET /v2/stocks/{symbol}/trades/latest?feed=iex` |
| Batch quotes | `GET /v2/stocks/quotes/latest?symbols=...&feed=iex` |
| Bars (1m/5m/15m/1d) | `GET /v2/stocks/{symbol}/bars?timeframe=...&feed=iex` |

Auth headers (server only):

- `APCA-API-KEY-ID` ← `ALPACA_MARKET_DATA_API_KEY`
- `APCA-API-SECRET-KEY` ← `ALPACA_MARKET_DATA_API_SECRET`

## Serverless request / caching design

- Short-lived REST snapshots per scheduled tick
- In-process quote/bar TTL cache (~15s) to reduce duplicate calls within one invocation
- Request timeout (default 8s)
- HTTP 429 respects `Retry-After`
- Circuit breaker after repeated provider failures
- Max watchlist size 10 (`ALPACA_MAX_WATCHLIST_SYMBOLS`)
- Batch quote endpoint used when scanning multiple symbols

## Watchlist validation

Default engineering list (editable, ≤10):

`AAPL MSFT NVDA AMZN META GOOGL SPY QQQ`

Each symbol must pass:

1. Alpaca market-data availability
2. Trading 212 Paper instrument availability (tradable stock/ETF)
3. GoldMeta universe eligibility rules

## Data freshness rules

- Quote max age for entry/monitor: **60 seconds**
- Missing Alpaca quote → block
- Stale quote → block
- Minutes-to-close must resolve → else block
- Provider outage / circuit open → block (and may lock)

## Alpaca / T212 divergence rule

Record separately:

- Alpaca quote + timestamp + feed
- T212 instrument id + latest readable price (when available) + currency + exchange + status

Configurable max divergence:

`STOCK_INTRADAY_MAX_PROVIDER_PRICE_DIVERGENCE_PCT` (default **1.5%**)

During SHADOW:

- Large divergence → block hypothetical entry
- Missing T212 price/validation → block
- Missing/stale Alpaca data → block

Before any future Paper execution, a fresh T212-side price must be re-checked (not enabled here).

## Indicators (GoldMeta-calculated)

Computed locally from Alpaca bars (TradingView may confirm, never sole source):

VWAP, EMA 9/21/50/200, RSI, ATR, volatility, relative volume, session status, minutes-to-close, broad-market trend.

## SHADOW decision recording

Every BUY / WAIT / BLOCKED decision persists fields including scan time, feed, quote, indicators, scores, reasons, sizing, stops/targets, and exit accounting (gross/net P/L, slippage, holding time, HWM/MAM).

## Shadow Performance UI

Status payload includes `shadowPerformance` + `readinessGates` + `marketData` (provider/feed/label).  
UI section surfaces sessions, evaluated/opened/closed, win/loss rates, gross/net P/L, drawdown, exit-reason counts, blocked/outage/stale/divergence counters.  
Disclaimer: results are hypothetical and do not guarantee future performance.

## Readiness gates

SHADOW starts only when gates pass (else engine stays paused), including:

- Alpaca credentials / provider ready
- T212 Paper read-only connected
- Feed reports IEX (or mock in tests)
- Market session resolvable
- Watchlist present (≤10)
- Firestore storage healthy
- Scheduler architecture healthy
- Restart reconciliation complete
- Both execution flags false
- Emergency stop operational

## Isolated SHADOW deployment preparation (do not deploy yet)

Use a **separate** preview Firebase project / function namespace. Placeholders only:

```bash
# Example — DO NOT use real secrets in docs/tickets/commits
export FIREBASE_PROJECT_ID="goldmeta-shadow-preview-XXXX"
export STOCK_INTRADAY_DEPLOYMENT_GENERATION="shadow-alpaca-iex-v1"
export STOCK_INTRADAY_MARKET_DATA="alpaca-iex"
export ALPACA_MARKET_DATA_API_KEY="ALPACA_KEY_PLACEHOLDER"
export ALPACA_MARKET_DATA_API_SECRET="ALPACA_SECRET_PLACEHOLDER"
export ALPACA_MARKET_DATA_FEED="iex"
export ALPACA_MARKET_DATA_BASE_URL="https://data.alpaca.markets"
export ALPACA_MAX_WATCHLIST_SYMBOLS="10"
export T212_PAPER_API_KEY="T212_PAPER_KEY_PLACEHOLDER"
export T212_PAPER_API_SECRET="T212_PAPER_SECRET_PLACEHOLDER"
export T212_PAPER_ORDER_SUBMISSION_ENABLED="false"
export T212_LIVE_EXECUTION_FEATURE_FLAG="false"
export STOCK_INTRADAY_MAX_PROVIDER_DIVERGENCE_PCT="1.5"

# Preview function deploy (illustrative — await Savio approval before running)
# firebase use "$FIREBASE_PROJECT_ID"
# firebase functions:config:set ...   # or Secret Manager bindings
# firebase deploy --only functions:stockIntradaySchedulerPreview --project "$FIREBASE_PROJECT_ID"
```

Requirements for isolation:

- Separate preview Firebase function or project
- Separate Firestore data namespace
- Separate deployment generation
- Alpaca IEX + T212 Paper read-only credentials
- No production function replacement
- No production Cloudflare Pages change
- No order-execution capability

**Do not deploy until Savio gives explicit approval.**

## Estimated API usage per US regular session (~6.5h)

Assumptions: 8 watchlist symbols, scan every 5 minutes, monitor every 1 minute for ≤3 open positions, bars warm-up on scan.

| Call type | Rough count / session |
|---|---|
| Latest quote+trade pairs (scan) | ~8 symbols × 78 scans ≈ 624 pairs |
| Batch quotes (optional scan path) | ~78 batch calls |
| Bars (5m + 1d warm-up per symbol/scan) | ~8 × 78 × 2 ≈ 1,248 |
| Monitor quotes/indicators | ~3 × 390 × (quote + bars) ≈ low thousands |
| **Order of magnitude** | **~3k–8k REST calls / session** depending on open positions and cache hits |

Stay within Alpaca free/IEX plan limits; circuit breaker + cache reduce bursts.

## Known IEX-only limitations

- Not full US consolidated tape (SIP)
- May miss trades / quotes printed on other venues
- Spreads and last prices can diverge from broker execution venues
- Suitable for engineering + SHADOW validation only
- Never market as production market coverage

## Related code

- `backend/src/services/stockIntraday/marketData/alpacaMarketDataProvider.ts`
- `backend/src/services/stockIntraday/watchlist.ts`
- `backend/src/services/stockIntraday/crossProvider.ts`
- `backend/src/services/stockIntraday/shadowPerformance.ts`
- `docs/V6_STOCK_INTRADAY_AUTOTRADE.md`
