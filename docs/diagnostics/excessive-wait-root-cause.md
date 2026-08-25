# Excessive WAIT states — root-cause report

**Branch:** `cursor/reduce-excessive-wait-6fc0`  
**Base:** `cursor/production-connection` @ `096355a`  
**Date:** 2026-08-06

## Exact reasons for repeated WAIT

1. **Primary (production traffic):** No Pine Bridge 3.0 `PLAN_15M` / `CONFIRM_5M` events — live feed still dominated by legacy 2.x bars without entry/stop/TP1 → geometry correctly yields `NO_VALID_PLAN` → UI chip **WAIT**.
2. **Confirmation attach gap:** `CONFIRM_5M` was accepted onto an active session plan even when `planSourceKey` differed from the active 15M plan. Feed health flagged `PLAN_SOURCE_KEY_MISMATCH` (amber) but the plan still showed incomplete/waiting confirmation → **MISSING_CONFIRMATION** / long WAIT.
3. **Hard vs soft confusion:** Trend vs confirmation candle conflict and incomplete optional inputs were surfaced as **CONFLICTED_DATA** / generic **STALE**, looking like corrupt data instead of “setup still forming”.
4. **Scoring WAIT:** Score not reaching ±70 without confirmation keeps decision **WAIT** even when a directional structure exists → should be **WATCHING / PREPARE**, not “no setup”.
5. **History noise:** Every WAIT decision becomes a separate card with lifecycle `WAIT_ONLY`, drowning PREPARE/READY outcomes.

## Stale / mismatched / out-of-order issues found

| Issue | Where | Impact |
| --- | --- | --- |
| Confirm without matching `planSourceKey` | `sessionPlanLifecycle` CONFIRM_5M path | Old 5M confirm attached to new 15M window |
| Generic STALE on snapshot age | `dataQuality` 5m window | No per-role freshness text |
| Feed role windows not configurable | `feedHealth` constants | Hard to tune QUOTE/CONFIRM/PLAN |
| Soft timeframe disagreement → CONFLICTED | `dataQuality.hasDirectionalConflict` | False “corrupt data” UX |
| Optional TP2 order treated soft | `tradePlanGeometry` | Invalid TP2&lt;TP1 (BUY) could linger |
| No TP3 chain check | `tradePlanGeometry` | BUY with TP2/TP3 below TP1 possible |
| Duplicate WAIT cards | `HistoryPage` | User sees spam of WAIT_ONLY |

## Losing BUY review (~4270.92)

No fixture or persisted history entry at entry **4270.92** exists in the repository. Nearest test prices are UI fixtures (~4265.31). Without production outcome rows in-repo we cannot recompute that trade’s ATR/spread path here.

**Validation added for similar failures:**
- Hard target order: BUY `stop < entry < TP1 < TP2 < TP3`; SELL reverse.
- Stop distance class: Too tight / Acceptable / Wide vs ATR + min points (does not auto-widen).

## Intended outcome (not more trades)

More **WATCHING / PREPARE BUY|SELL** guidance and accurate **BLOCKED** only for hard safety/data failures — without lowering readiness thresholds or enabling AutoTrade.
