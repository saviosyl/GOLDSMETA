# Gold Hunter V6 Revision 03 — Demo test plan

Revision identity: `GH-B6-20260824-03` / `PULSE_GUARD_RELIABILITY`.

This plan qualifies reliability and expectancy; it does not promise profit. It
does not authorize production deployment, Demo Auto activation, Live mode, or a
broker order. Those remain separate owner decisions.

## What changed

- Setup A / Pulse Guard is the only executable setup. B/C and the Revision 02
  continuation candidate remain diagnostic-only.
- Entry needs a cost-aware remaining movement budget of at least `1.05R` plus
  spread, friction, and recent-noise allowances.
- Lot sizing adds a `0.05` XAUUSD price slippage-risk reserve while the broker
  emergency stop stays `0.55` from the final pretransport quote.
- The final candidate, spread, microstructure, entry hint, and stop are refreshed
  synchronously after awaited preparation and immediately before order transport.
- Actual initial risk is persisted from confirmed fill to broker stop for both BUY
  and SELL.
- The small-profit harvest is disabled by default. Smart PM manages qualified
  winners; ordinary losers retain the `-0.45R` soft loss controller.
- Settled-loss, streak, rolling-R, anti-churn, and fresh-regime state is rebuilt
  from the durable Demo trade ledger on worker startup and survives feed resync.

## Required validation sequence

1. **CI and replay**
   - Backend build, lint, unit, protected-core gates, and Firestore-emulator tests
     must pass on the exact proposed commit.
   - Clean replay must be current and integrity-clean.
   - At least 250 clean closed shadow trades are required for an edge decision.
   - Continue only when net quote P&L is positive, expectancy is positive, and
     profit factor is at least `1.15`. A promising 250-trade result continues to
     500; it is not a Live approval.

2. **Controlled Demo verification**
   - Keep Live and broker Live execution disabled.
   - Start with Demo Auto OFF and verify the owner/account, XAUUSD metadata,
     quote/depth freshness, loss-state hydration, and zero unknown open exposure.
   - Verify one controlled BUY and one controlled SELL separately, including
     final entry/stop, confirmed fill, persisted `initialRiskPrice`, close
     settlement, and restart recovery.
   - Recreate/restart the worker between controlled cases and prove the settled
     loss/rolling-R state is identical before and after restart.

3. **Small Demo observation**
   - Only after the controlled checks pass, enable Demo Auto with the existing
     one-position maximum and approved allocation/risk settings.
   - Do not change thresholds during the sample. A config change starts a new
     qualification identity/sample.
   - Review results by setup, side, session, spread, entry slippage, exit reason,
     actual R, and restart/resync events. Do not evaluate only win rate.

## Immediate stop conditions

- Any Live environment/account is selected.
- Loss-state hydration fails or selector readiness reports a fatal blocker.
- Unknown/PENDING broker exposure cannot be reconciled authoritatively.
- A non-A setup reaches order submission.
- A stale/resynced candidate, invalid depth, or wide spread reaches transport.
- Persisted entry, stop, fill, or initial-risk geometry is missing/invalid.
- Duplicate order/claim evidence, more than one open position, or order outcome
  ambiguity is observed.
- Replay/integrity is stale, qualification data is mixed across revisions, or the
  250-trade edge classification is negative/insufficient.

## Trial result record

Record the exact commit, deployment IDs, Demo account mask, start/end timestamps,
qualification ID, closed-trade count, BUY/SELL counts, net P&L, expectancy,
profit factor, average win/loss R, maximum drawdown, spread/slippage distribution,
exit-reason distribution, restart/resync count, and every stop condition checked.
