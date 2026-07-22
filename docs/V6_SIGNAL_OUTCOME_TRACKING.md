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
2. **No same-candle lookahead** — creation candle rejected; entry starts next bar.
3. **Bar identity** — `symbol` / `timeframe` / `environment` + `lastAppliedBarTime`.
4. **Atomic Firestore update** — lease + apply + persist + release in one transaction.
5. **Durable outcome-monitor jobs** — create trigger + **scheduled retry pass**
   (`retryOutcomeMonitorJobs` every 1 minute) for FAILED jobs past `nextAttemptAt`
   with exponential backoff, max attempts, DEAD_LETTER, and scheduler heartbeat.
6. **Partial PnL** — independent exit legs; outcome from net R.
7. **Confidence bands** — 90–100 … below 60 on 0–100 scale.
8. **Complete history** — paginated list + daily aggregates.
9. **CI + Playwright** — workflow filters for approved base; Signal History e2e.
10. **Entry-candle ordering** — entry+stop+TP without ticks → `ENTRY_SEQUENCE_AMBIGUOUS`;
    entry+stop or entry+TP → record entry only, defer exits to next candle; ordered
    ticks resolve sequence when available.
11. **Fail-closed storage** — in-memory only for `NODE_ENV=test` or
    `SIGNAL_OUTCOME_ALLOW_MEMORY=true`; otherwise refuse create/monitor.
12. **Indexes** — `outcomeMonitorJobs(state, nextAttemptAt)` and
    `signalOutcomes(lifecycle, symbol, environment, timeframe)`.

## Flags

No broker execution flags are enabled. Keep
`DEMO_ORDER_SUBMISSION_ENABLED=false` and `LIVE_EXECUTION_FEATURE_FLAG=false`.
