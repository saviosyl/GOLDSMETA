# Trading 212 API verification (XAUUSD)

**Verified:** 2026-07-20  
**Source:** Official Trading 212 Public API docs — https://docs.trading212.com/api  
**GoldMeta commit baseline:** `3edb7cd` (pre–trading-modes)

## Verdict

**Trading 212 Public API does not support XAUUSD CFD trading or CFD position management for automated GoldMeta Live Auto execution.**

| Capability | Supported by Trading 212 Public API? | Notes |
|---|---|---|
| Invest / Stocks ISA equities & ETFs | Yes | Documented `/api/v0/equity/*` surface |
| CFD / Invest CFD account types | **No** | Docs: API “enabled and usable only for Invest and Stocks ISA account types” |
| XAUUSD (gold) CFD instruments | **No** | Equity instruments API is stocks/ETFs (e.g. `AAPL_US_EQ`), not CFDs |
| Automated market/limit/stop orders on XAUUSD CFD | **No** | Orders endpoints are equity-only |
| Position management (partial close, SL/TP, BE) on XAUUSD CFD | **No** | Positions are equity share positions |
| Cancel pending equity orders | Yes (equity only) | Not applicable to GoldMeta XAUUSD CFD workflow |

## Implication for GoldMeta

1. **Trading 212 remains a manual execution option** — the app/backend may show analysis and human trade instructions the user can place themselves in the Trading 212 app/UI.
2. **Live Auto must not call Trading 212 for XAUUSD CFD orders.**
3. Broker connection layer is **adapter-based** so a future CFD-capable broker (official API supporting XAUUSD + required order ops) can be plugged in without rewriting decision logic.
4. **Broker API credentials are never stored on iOS, in logs, source, or GitHub.** They are accepted only by the backend and stored as encrypted secrets (Secret Manager / encrypted Firestore fields).

## Re-check policy

Re-verify this document if Trading 212 publishes CFD API support. Until then, treat any third-party “T212 CFD bot” claims as unsupported for GoldMeta production Live Auto.
