# Missed-opportunity report — 11 Aug 2026 (READ ONLY)

Source: `users/{uid}/autotradeEvaluationLog` for the authenticated owner.
No strategy thresholds were changed for this report.
Qualification state for actionable rows: **LIVE_QUALIFICATION** (Demo Auto authority was ON; orders were blocked by session/confirmation gates).

## Summary counts (all evaluations that day)

| Blocker bucket | Count |
|---|---:|
| SESSION_BLOCKED | 3 |
| SESSION_PLAN_NO_VALID_PLAN | 9 |
| CONFIRMATION waiting/failed | 9 |
| CONFIDENCE_TOO_LOW | 0 |
| RR_TOO_LOW | 0 |
| SPREAD | 0 |
| STALE_QUOTE | 0 |
| DAILY LIMIT | 0 |
| AUTOTRADE AUTHORITY | 0 |
| WAIT_HOLD | 34 |
| OTHER | 0 |

Total evaluations: **55**. Actionable BUY/SELL evaluation rows: **21**.

## Actionable BUY/SELL rows

| Time (UTC) | Dir | Score | Qual state | Armed / confirmation | Session / plan | Final blocker | Would order if that ONE blocker removed? |
|---|---|---:|---|---|---|---|---|
| 2026-08-11T00:30:18.336Z | BUY | 100 | LIVE_QUALIFICATION | SESSION_BLOCKED | SESSION_BLOCKED | SESSION_BLOCKED | yes* |
| 2026-08-11T00:31:50.898Z | BUY | 100 | LIVE_QUALIFICATION | SESSION_BLOCKED | SESSION_BLOCKED | SESSION_BLOCKED | yes* |
| 2026-08-11T00:45:14.120Z | BUY | 82 | LIVE_QUALIFICATION | waiting confirmation | — | CANDIDATE_ARMED (CANDLE_CONFIRMATION_REQUIRED) | yes* |
| 2026-08-11T01:00:13.592Z | BUY | 82 | LIVE_QUALIFICATION | invalidated | SESSION_PLAN_NO_VALID_PLAN | CANDIDATE_INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | yes* |
| 2026-08-11T01:30:13.195Z | BUY | 93 | LIVE_QUALIFICATION | waiting confirmation | — | CANDIDATE_ARMED (CANDLE_CONFIRMATION_REQUIRED) | yes* |
| 2026-08-11T02:12:16.797Z | BUY | 100 | LIVE_QUALIFICATION | SESSION_BLOCKED | SESSION_BLOCKED | SESSION_BLOCKED | yes* |
| 2026-08-11T02:45:11.443Z | BUY | 100 | LIVE_QUALIFICATION | invalidated | SESSION_PLAN_NO_VALID_PLAN | CANDIDATE_INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | yes* |
| 2026-08-11T03:30:09.910Z | BUY | 92 | LIVE_QUALIFICATION | waiting confirmation | — | CANDIDATE_ARMED (CANDLE_CONFIRMATION_REQUIRED) | yes* |
| 2026-08-11T04:15:08.568Z | BUY | 92 | LIVE_QUALIFICATION | invalidated | SESSION_PLAN_NO_VALID_PLAN | CANDIDATE_INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | yes* |
| 2026-08-11T08:00:16.264Z | SELL | 96 | LIVE_QUALIFICATION | waiting confirmation | — | CANDIDATE_ARMED (CANDLE_CONFIRMATION_REQUIRED) | yes* |
| 2026-08-11T08:15:14.414Z | SELL | 96 | LIVE_QUALIFICATION | invalidated | SESSION_PLAN_NO_VALID_PLAN | CANDIDATE_INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | yes* |
| 2026-08-11T12:00:21.322Z | BUY | 91 | LIVE_QUALIFICATION | waiting confirmation | — | CANDIDATE_ARMED (CANDLE_CONFIRMATION_REQUIRED) | yes* |
| 2026-08-11T12:26:20.631Z | BUY | 91 | LIVE_QUALIFICATION | invalidated | SESSION_PLAN_NO_VALID_PLAN | CANDIDATE_INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | yes* |
| 2026-08-11T12:45:14.222Z | BUY | 94 | LIVE_QUALIFICATION | waiting confirmation | — | CANDIDATE_ARMED (CANDLE_CONFIRMATION_REQUIRED) | yes* |
| 2026-08-11T13:00:35.490Z | BUY | 94 | LIVE_QUALIFICATION | invalidated | SESSION_PLAN_NO_VALID_PLAN | CANDIDATE_INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | yes* |
| 2026-08-11T13:45:13.260Z | BUY | 96 | LIVE_QUALIFICATION | waiting confirmation | — | CANDIDATE_ARMED (CANDLE_CONFIRMATION_REQUIRED) | yes* |
| 2026-08-11T14:00:18.509Z | BUY | 96 | LIVE_QUALIFICATION | invalidated | SESSION_PLAN_NO_VALID_PLAN | CANDIDATE_INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | yes* |
| 2026-08-11T18:00:15.905Z | SELL | 94 | LIVE_QUALIFICATION | waiting confirmation | — | CANDIDATE_ARMED (CANDLE_CONFIRMATION_REQUIRED) | yes* |
| 2026-08-11T18:34:48.923Z | SELL | 94 | LIVE_QUALIFICATION | invalidated | SESSION_PLAN_NO_VALID_PLAN | CANDIDATE_INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | yes* |
| 2026-08-11T20:53:35.924Z | SELL | 86 | LIVE_QUALIFICATION | waiting confirmation | — | CANDIDATE_ARMED (CANDLE_CONFIRMATION_REQUIRED) | yes* |
| 2026-08-11T21:13:45.125Z | SELL | 86 | LIVE_QUALIFICATION | invalidated | SESSION_PLAN_NO_VALID_PLAN | CANDIDATE_INVALIDATED (SESSION_PLAN_NO_VALID_PLAN) | yes* |

\* “yes” means the evaluation recorded a single failed gate code. It does **not** prove a fill — later gates (spread/quote/risk/broker) were not re-run with that gate removed.

## Interpretation for the NEXT strategy PR (not this recovery PR)

1. **SESSION_BLOCKED** (Asia / outside London–NY) blocked early actionable signals.
2. Several high-score setups armed, then died on **CANDLE_CONFIRMATION_REQUIRED** → **SESSION_PLAN_NO_VALID_PLAN** invalidation.
3. No AUTOTRADE AUTHORITY / INTENT_OFF / confidence / RR / spread / stale-quote blockers appear in this day's log.
4. Do **not** retune thresholds in PR #107 — use this table in a dedicated follow-up.

