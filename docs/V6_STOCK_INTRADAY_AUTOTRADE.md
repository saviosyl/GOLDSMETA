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
| SHADOW | Full logic, hypothetical trades, no broker orders |
| T212_PAPER_AUTO | Architecture ready; **submission disabled** |
| T212_LIVE_AUTO | UI/architecture only; **hard-blocked** |

Flags (hard-coded false):

- `T212_PAPER_ORDER_SUBMISSION_ENABLED=false`
- `T212_LIVE_EXECUTION_FEATURE_FLAG=false`

## Architecture

```
TradingView webhook / scanner
        │
        ▼
signalIngestion (auth, dedupe, stale, queue) ──► fast 202 ACK
        │
        ▼
rankingEngine → Ranked Intraday Opportunities
        │
        ▼
riskEngine + positionSizing + stateMachine
        │
        ▼
T212 adapter (Paper read-only; orders behind flags)
        │
        ▼
GoldMeta-managed positions + audit trail
```

Market data: `MarketDataProvider` + `MockMarketDataProvider` (tests) + `UnconfiguredMarketDataProvider` (fail closed until a real provider is selected).

## Entry workflow

1. Signal/candidate received  
2. Validate freshness, instrument (stock/ETF only), market open  
3. Rank; select highest **qualifying** opportunity (absolute checks)  
4. Size from risk/capital/reserve/exposure  
5. Atomic intent reservation (idempotency key)  
6. SHADOW → record only; PAPER/LIVE → blocked by flags  

## Exit workflow

Exit reasons include hard stop, TP, trailing, TV EXIT_LONG, VWAP loss, max hold, EOD, kill switch.  
Only `goldMetaManaged` positions may be closed. Never personal holdings.

## State machine

`CANDIDATE → VALIDATING → APPROVED → ENTRY_RESERVED → ENTRY_SUBMITTING → … → OPEN → EXIT_* → CLOSED`  
Unknown submission → `ENTRY_UNKNOWN` / `RECONCILIATION_REQUIRED` / symbol lock — **never blind resubmit** (T212 market orders are not idempotent).

## Secrets (server only)

`T212_PAPER_API_KEY`, `T212_PAPER_API_SECRET`, `T212_LIVE_API_KEY`, `T212_LIVE_API_SECRET`

## API routes

`/v1/stock-intraday/*` — status, mode, limits, connect/paper, disconnect, emergency-stop, unlock, reconcile, shadow/scan, signals/tradingview

## UI

- `/stocks-intraday` and `/ui-review/stocks-intraday`
- Nav: Gold CFD · Stocks Intraday

## Known limitations

- No market-data vendor selected yet → real Auto remains disabled  
- T212 protective-stop behaviour for Live not certified → Live stays blocked  
- Paper order submission intentionally false  
- First delivery uses in-memory store for local/test; Firestore namespace reserved (`stockIntraday`)  
- T212 equity API field shapes may vary; HTTP adapter maps defensively  

## Safety confirmations

- Production unchanged  
- IG AutoTrade behaviour unchanged  
- No Paper order submitted  
- No Live order submitted  
- Both execution flags false  
