# GoldMeta V4 — Stage A Research Report

> **Historical document** (2026-07-21). V4 research / stage gates only.
> Current AutoTrade architecture: [`MULTI_USER_AUTOTRADE_ARCHITECTURE.md`](./MULTI_USER_AUTOTRADE_ARCHITECTURE.md).

**Date:** 2026-07-21  
**Branch:** `cursor/goldmeta-v4-engine-c2c2`  
**Engine:** `1.0.0-v4-stage-a` / `strategyVersion=4` / `v4-config-1.0.0`  
**Production strategy:** legacy **strategyVersion=3** (unchanged actionable path)  
**Broker:** `DISABLED` · **AI:** `false` · **V4 actionable LIVE:** `false`

Profit cannot be guaranteed. This report does **not** authorise automatic execution.

---

## 1. V3 root-cause audit

| Issue | Evidence | V4 response |
| --- | --- | --- |
| Tiny stops (e.g. entry 4072.31 / stop 4072.09) | `tradePlanEngine.selectStopLoss` picks **nearest** structure below/above entry with **no ATR/spread/absolute floor** | `stopEngine` enforces `max(structural, ATR×0.35, spread×3, 1.5pts)` and rejects `NO_TRADE_INVALID_RISK_GEOMETRY` |
| Inflated RR from tiny risk | Min RR guard uses `|entry−SL|` so tight stops pass 1.5R easily | Targets/costs use validated risk distance; net RR after costs required |
| Confidence as pseudo-probability | UI “Confidence: N%” | Replaced conceptually with **Setup quality /100** + disclaimer (V4 path) |
| Single-candle setups | V3 can score/plan from one snapshot | Multi-bar confirmation mandatory (`minBars=2`) |
| One blended score for all styles | Single `scoreSnapshot` | Strategy A and B separately detected, versioned, reported |
| No transaction costs in analytics | Setup R is raw/modelled without spread | Cost engine estimates spread+slippage; backtest uses **net R** |
| CFD volume treated as profile truth | XAUUSD TV session profile only | Profile `source` recorded; COMEX GC preferred when present; conflict reduces quality |
| No `strategyVersion` | Absent in backend | V3 treated as legacy `3`; V4 tagged `4` |

---

## 2. XAUUSD / GC data-source audit

| Feed | Status |
| --- | --- |
| XAUUSD price (TV webhook) | Production path — required |
| XAUUSD session volume profile | Available on payload; **not** exchange volume |
| COMEX GC profile | **Not wired** — `gcProfile: null` in shadow adapter; hierarchy ready |
| 1h / 15m / 5m / 1m | V4 types support; Stage A shadow synthesizes limited history from snapshot |

Preferred hierarchy implemented in code: GC confirmed → XAU local → reject/reduce on material conflict.

---

## 3. POC / profile methodology

- POC is a **zone** (`max(0.5pts, ATR×0.15, tick×10)`).
- Gates: VAH>POC>VAL, min bars, volume observations, min VA width.
- Sessions modelled: Asia / London / NY / developing / prior day fields on profile type.
- Invalid/stale profiles → hard gate `INVALID_PROFILE`.

---

## 4. Strategy definitions

**A — VALUE_BREAKOUT_RETEST:** HTF trend + close beyond VAH/VAL + acceptance + retest hold + confirmation close + POC migration compatible.

**B — FAILED_AUCTION_REVERSAL:** Probe beyond VA + failure to accept + close back inside + recovery/rejection confirmation.

Families are never blended into one BUY score.

---

## 5. Stop / target / cost methodology

- Stops: structural candidates + volatility/spread floors; never exactly at POC/VAH/VAL.
- Targets: 1R/2R/3R theoretical + structure-aware selection; reject if opposing structure blocks TP1 path.
- Costs: session default spread + slippage (estimate-only labels).

---

## 6. Backtest methodology & anti-overfit

- Event-driven, chronological windows.
- Worst-case same-bar **SL before TP**.
- Candidate expiry / missed entries reflected via path length.
- Experiment IDs hashed from label+config version.
- Embargo bars recorded between folds.
- **Do not** tune on final test period (governance note in report object).
- Synthetic smoke series for CI only — **not** acceptance evidence.

---

## 7. Results (Stage A)

### Historical in-sample / out-of-sample / walk-forward

**Insufficient real multi-year XAUUSD+GC bar archive in-repo.**  
Synthetic smoke backtests are for pipeline verification only.

| Metric | Synthetic smoke (illustrative) |
| --- | --- |
| Resolved trades | Typically ≪ 200 |
| Meets acceptance gates | **No** (by design until real OOS) |
| Plan mutation count | **0** (locked plans immutable) |

### Shadow-mode results

Shadow compute hooks after V3 `saveDecision` (non-fatal). Persists to `users/{uid}/v4Shadows`.  
Live shadow sample size at Stage A start: **0** until production deploy with `V4_SHADOW_*=true`.

### By strategy / session / regime / direction

Reported in `V4BacktestReport.by*` once real series are loaded.

---

## 8. Acceptance gates (not yet passed)

Required before Stage D manual €20 forward test:

- ≥200 OOS resolved trades (where data permits)
- Positive net expectancy **after costs**
- Profit factor ≥ 1.20
- Tolerable drawdown; not one-day dependent
- Multi-month stability; BUY/SELL and London/NY stability or disable weak side
- LIVE shadow ≥50 resolved; **0** unsafe stops; **0** plan mutations; no material deterioration

**Recommendation:** **Do not progress V4 to manual €20 testing yet.** Remain in **Stage A → Stage B shadow** after deploying shadow flags. Collect real OOS + shadow evidence first.

---

## 9. Deployment stages (status)

| Stage | Status |
| --- | --- |
| A Research | **In progress** — engine + backtester + report |
| B Live shadow | Code ready (`V4_SHADOW_COMPUTE_ENABLED`); not promoting signals |
| C Review | Blocked on evidence |
| D Manual €20 | Blocked — `actionableLiveEnabled=false` hard |
| E Demo API | Blocked — broker remains DISABLED |

---

## 10. Files added (core)

- `backend/src/services/v4/*` — config, profile, regime, strategies, stop, targets/costs, gates/score, news, ML abstain, engine, backtester, shadow
- `backend/src/routes/v4.ts` — status / shadows / admin smoke backtest
- `web/src/pages/V4ResearchPage.tsx` — non-actionable research UI (`/v4`)
- Shadow hook in `decisionPipeline.ts` (does not alter V3 outputs)

---

## 11. Safety confirmation

- No IG live/demo order placement
- No `ios/` changes
- No DNS changes
- Existing decisions/setups not deleted
- Production V3 path unchanged for actionable signals
