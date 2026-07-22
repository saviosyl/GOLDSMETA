# V6 Signal Outcome Tracking

**Branch:** `cursor/goldmeta-v6-signal-outcome-tracking-c2c2`  
**Base:** `cursor/v5-4-3-approved-base-c2c2` @ `4621156`  
**Status:** Draft PR — do not merge / do not deploy without separate approval

## Purpose

Track hypothetical BUY/SELL signal performance after the original trade plan is
frozen. Confidence is a **setup-confidence score**, not probability of profit.

Every closed result is labelled **HYPOTHETICAL SIGNAL PERFORMANCE** with the
disclaimer: *Past hypothetical results do not guarantee future trading
performance.*

## Architecture

| Piece | Detail |
|-------|--------|
| Snapshot | Immutable freeze at decision create (`freezeSignalSnapshot`) |
| Lifecycle | `WAIT_ONLY` … `AMBIGUOUS_INTRABAR` (see engine) |
| Market data | TradingView confirmed OHLCV via existing webhook → `processJob` |
| Persistence | `users/{uid}/signalOutcomes/{signalId}` |
| Idempotency | `appliedBarEventIds` + lease (`tryAcquireLease`) |
| Broker | **None** — no IG / T212 order endpoints |

## Monitoring

1. Decision saved in `processJob`
2. `syncDecisionAndMonitor` creates/loads signal outcome
3. Confirmed bar OHLCV applied via `applyBarToSignalOutcome`
4. Duplicate `eventId` skipped; leases prevent multi-worker races

## Ambiguity

Same-candle stop + target → `AMBIGUOUS_INTRABAR` (excluded from win rate).

## APIs

- `GET /v1/signal-outcomes`
- `GET /v1/signal-outcomes/performance`
- `GET /v1/signal-outcomes/:signalId`
- `GET /v1/signal-outcomes/by-decision/:decisionId`

## UI

- Signal History shows entry/stop/TPs/lifecycle/P/L for BUY/SELL
- WAIT shows analysis-only (not a trade)
- `/signal-performance` dashboard

## Flags

No broker execution flags are enabled by this feature.
