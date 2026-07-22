# V6 Signal Outcome Tracking

**Branch:** `cursor/goldmeta-v6-signal-outcome-tracking-c2c2`  
**Base:** `cursor/v5-4-3-approved-base-c2c2` @ `4621156`  
**Status:** Draft PR — do not merge / do not deploy without separate approval

## Purpose

Track hypothetical BUY/SELL signal performance after the original trade plan is
frozen. Confidence is a **setup-confidence score** on the GoldMeta **0–100**
scale, not probability of profit.

Every closed result is labelled **HYPOTHETICAL SIGNAL PERFORMANCE** with the
disclaimer: *Past hypothetical results do not guarantee future trading
performance.*

## Hardening (PR #24)

1. **Future-bar monitoring** — each confirmed OHLCV bar monitors all matching
   active signals (`userId`, `symbol`, `timeframe`, `environment`).
2. **No same-candle lookahead** — creation candle (`barTime <= marketDataTimestamp`)
   is rejected; entry monitoring starts on the next confirmed bar.
3. **Bar identity** — `SignalBarInput` carries `symbol`, `timeframe`, `environment`;
   `lastAppliedBarTime` persisted; wrong identity / duplicate event / older bars rejected.
4. **Atomic Firestore update** — lease + apply + persist + release in one transaction.
5. **Durable outcome-monitor jobs** — independent of decision `processingJobs`, with
   lease, retry, exponential backoff, `nextAttemptAt`, dead-letter, audit reason.
6. **Partial PnL** — independent exit legs; weighted total; outcome from net R.
7. **Confidence bands** — 90–100, 80–89, 70–79, 60–69, below 60.
8. **Complete history** — paginated `listAllPaginated` + daily aggregates (not newest-500 only).
9. **CI** — workflows include approved base so PR #24 runs Actions; Playwright coverage.

## Architecture

| Piece | Detail |
|-------|--------|
| Snapshot | Immutable freeze at decision create (`freezeSignalSnapshot`) |
| Lifecycle | `WAIT_ONLY` … `AMBIGUOUS_INTRABAR` (see engine) |
| Market data | TradingView confirmed OHLCV via existing webhook → decision job enqueues `outcomeMonitorJobs` |
| Persistence | `users/{uid}/signalOutcomes/{signalId}` |
| Idempotency | `appliedBarEventIds` + `lastAppliedBarTime` + atomic `applyBarAtomic` |
| Broker | **None** — no IG / T212 order endpoints |

## Flags

No broker execution flags are enabled by this feature. Keep
`DEMO_ORDER_SUBMISSION_ENABLED=false` and `LIVE_EXECUTION_FEATURE_FLAG=false`.
