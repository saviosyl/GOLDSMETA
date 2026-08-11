# Next Candle Edge — Design Note (NOT BUILT)

Status: **design only**. Do not implement or wire to AutoTrade execution in this PR.

## Purpose

A later calibrated module that estimates short-horizon directional edge on XAUUSD
after a GoldMeta setup decision, without claiming that setup score equals
probability.

## Required outputs

| Field | Meaning |
|------|---------|
| `P(next_5m_up)` | Calibrated probability next 5-minute candle closes up |
| `P(next_5m_down)` | Calibrated probability next 5-minute candle closes down |
| `expected_move_atr` | Expected absolute move in ATR units |
| `NO_EDGE` | Explicit state when calibration does not support a tradeable edge |

## Hard constraints

1. **Do not** equate setup score / confidence with probability.
2. **Do not** connect Next Candle Edge to order submission until walk-forward and
   out-of-sample calibration prove improved expectancy vs the current gates.
3. Publish calibration provenance (train window, holdout, Brier/log-loss, ECE).
4. Fail closed to `NO_EDGE` when quote/session/news gates already block.

## Suggested later integration points

- Read-only diagnostics panel beside DEMO AUTOTRADE HEALTH
- Optional arming soft-signal (never sole execution authority)
- Journal enrichment for skipped vs taken setups

## Out of scope for AutoTrade recovery SSOT work

Execution authority remains `demoAutoExecutionAuthority` + qualification gates.
This note exists so the product roadmap does not invent probability from setup score.
