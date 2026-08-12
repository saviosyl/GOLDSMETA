# 11 Aug 2026 — STRICT vs ACTIVE_DEMO counterfactual replay

**Read-only.** Uses production `autotradeEvaluationLog` only.
Pairs `CANDIDATE_ARMED` + later `CANDIDATE_INVALIDATED` as **one** opportunity.
Does **not** claim profitability or guaranteed broker fills.
Setup score ≠ win probability.

Unique opportunities: **11** (from 21 actionable eval rows).

## Summary

| Metric | STRICT (old) | ACTIVE_DEMO (new) |
|---|---:|---:|
| Unique opportunities | 11 | 11 |
| Confirmed broker orders (from log) | 0 | 0 (counterfactual) |
| Cancelled solely by SESSION_PLAN_NO_VALID_PLAN | 8 | 0 (kept armed) |
| Opportunities improved (kept/armed vs killed) | — | 6 |
| Wins / losses / R | n/a (0 fills) | n/a — needs live Demo fills |

## Per unique opportunity

| Time UTC | Dir | Score | Tier | Session | Entry | SL | TP | STRICT | ACTIVE_DEMO |
|---|---|---:|---|---|---:|---:|---:|---|---|
| 2026-08-11T00:30:18.336Z | BUY | 100 | A+ | Asia | 4414.08 | 4409.2 | 4418.96 | SESSION_BLOCKED | ELIGIBLE_ARM: Asia experimental A+ (0.50× risk); still needs confirmation + gates — no fill inventable |
| 2026-08-11T00:45:14.120Z | BUY | 82 | A | Asia | 4414.27 | 4407.62 | 4414.53 | ARMED→INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | WOULD_KEEP_ARMED: NO_VALID_PLAN → PLAN_REFRESH_UNAVAILABLE; Asia A allowed at 0.50×; wait ≤15m for confirm |
| 2026-08-11T01:30:13.195Z | BUY | 93 | A+ | Asia | 4419.43 | 4412.85 | 4419.56 | ARMED waiting / unresolved | CANDIDATE_KEPT: Asia A+/A allowed; would ARM (fast confirm only if decision confirmation supports) |
| 2026-08-11T02:12:16.797Z | BUY | 100 | A+ | Asia | 4429.81 | 4421.75 | 4437.87 | SESSION_BLOCKED | ELIGIBLE_ARM: Asia experimental A+ (0.50× risk); still needs confirmation + gates — no fill inventable |
| 2026-08-11T03:30:09.910Z | BUY | 92 | A+ | Asia | 4420.48 | 4415.32 | 4424.89 | ARMED→INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | WOULD_KEEP_ARMED / CANDIDATE_KEPT: Asia A+ allowed; keep armed through plan refresh until expiry/confirm |
| 2026-08-11T08:00:16.264Z | SELL | 96 | A+ | London | 4357.66 | 4358.45 | 4356.87 | ARMED→INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | WOULD_KEEP_ARMED: NO_VALID_PLAN → PLAN_REFRESH_UNAVAILABLE; keep monitoring until expiry/confirm |
| 2026-08-11T12:00:21.322Z | BUY | 91 | A+ | Overlap | 4387.8 | 4385 | 4390.6 | ARMED→INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | WOULD_KEEP_ARMED: NO_VALID_PLAN → PLAN_REFRESH_UNAVAILABLE; keep monitoring until expiry/confirm |
| 2026-08-11T12:45:14.222Z | BUY | 94 | A+ | Overlap | 4398.73 | 4388.91 | 4408.55 | ARMED→INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | WOULD_KEEP_ARMED: NO_VALID_PLAN → PLAN_REFRESH_UNAVAILABLE; keep monitoring until expiry/confirm |
| 2026-08-11T13:45:13.260Z | BUY | 96 | A+ | Overlap | 4399.78 | 4392.07 | 4400.17 | ARMED→INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | WOULD_KEEP_ARMED: NO_VALID_PLAN → PLAN_REFRESH_UNAVAILABLE; keep monitoring until expiry/confirm |
| 2026-08-11T18:00:15.905Z | SELL | 94 | A+ | NewYork | 4369.19 | 4377.4 | 4360.98 | ARMED→INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | WOULD_KEEP_ARMED: NO_VALID_PLAN → PLAN_REFRESH_UNAVAILABLE; keep monitoring until expiry/confirm |
| 2026-08-11T20:53:35.924Z | SELL | 86 | A | NewYork | 4367.52 | 4369.93 | 4360.34 | ARMED→INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | WOULD_KEEP_ARMED: NO_VALID_PLAN → PLAN_REFRESH_UNAVAILABLE; keep monitoring until expiry/confirm |

## Expected Demo opportunity increase

- **8** setups that were armed then cancelled by NO_VALID_PLAN would **remain armed** for up to 15 minutes.
- **2** Asia SESSION_BLOCKED A+/A rows become **eligible to arm** under experimental Asia policy (0.5× risk).
- Entry still requires confirmation + all safety/broker gates — this replay cannot invent fills.

## Multi-day replay

Evaluation log days available: **4** (since 2026-07-23).

| Day | Evals | Armed | Invalidated | Session blocked |
|---|---:|---:|---:|---:|
| 2026-08-09 | 7 | 0 | 0 | 0 |
| 2026-08-10 | 76 | 4 | 1 | 2 |
| 2026-08-11 | 58 | 9 | 9 | 3 |
| 2026-08-12 | 18 | 3 | 3 | 0 |

Full STRICT vs ACTIVE_DEMO expectancy (win rate, avg R, PF, drawdown) **cannot be computed** without historical Demo fills + OHLC outcome labels.
Do not optimize thresholds on this sample.

