# Plan opportunity blocking — production diagnosis

**Generated:** 2026-08-05  
**Project:** `goldmeta-web`  
**Code HEAD analysed:** `6e2a927` (PR #61 Plan V2 on `cursor/v5-4-3-approved-base-c2c2`)  
**Method:** read-only Firestore REST scan via `FIREBASE_TOKEN` (no secrets printed, no mutations)

## Executive root cause

Production is stuck on **WAIT — NO VALID PLAN / Trade levels failed safety validation** primarily because **no Pine Bridge 3.0.0 `PLAN_15M` events are arriving**.

Observed traffic is **Pine 2.0.4 / schema 1.0** OHLC and structure updates **without** direction, entry, stop, or TP1. The geometry gate then correctly hard-blocks (`DIRECTION_NOT_TRADEABLE`, `MISSING_REQUIRED_LEVEL`).

Secondary code risk (not yet exercised by production payloads with levels): session-plan geometry treats **quick-target failure** and **LIVE_RANGE_ONLY / incomplete optional profile** as fatal, which would erase otherwise valid Entry/Stop/TP1 plans once Pine 3.0 starts delivering levels.

## Production funnel (read-only)

| Window | PLAN_15M | CONFIRM_5M | QUOTE_1M | LEGACY_STRATEGY | UNKNOWN/other | scriptVersion | schemaVersion |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 24h | **0** | **0** | **0** | 99 | 804 | 2.0.4 (896), unknown (7) | 1.0 only |
| 3d | **0** | **0** | **0** | 118 | 1444 | 2.0.4 (1547) | 1.0 only |
| 7d | **0** | **0** | **0** | 314 | 1539 | 2.0.4 (1838) | 1.0 only |

Scan totals: **16 users**, **1951 rawEvents**, **150 decisions** sampled.

### Payload completeness (plan-source roles only)

| Window | Complete (dir+entry+stop+TP1) | Incomplete | BUY | SELL | WAIT | Has Entry/Stop/TP1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 24h | 0 | 99 | 0 | 0 | 99 | **0** |
| 3d | 0 | 118 | 0 | 0 | 118 | **0** |
| 7d | 0 | 314 | 0 | 0 | 314 | **0** |

`chartMatchesRole`: **null** on all sampled events (Pine 3.0 field absent).  
`planSourceKey`: **absent**.  
Sampled 5m/15m bars: OHLC present; **no trade levels**.

### Active session plans

| Metric | Value |
| --- | --- |
| Active docs | 3 (collection-group); detailed sample shows NO_VALID_PLAN |
| Lifecycle | **100% `NO_VALID_PLAN`** |
| With levels | **0** |
| alertRole | `LEGACY_STRATEGY` |
| pine scriptVersion on plan | unknown / not 3.0.0 |
| Geometry reasons | `DIRECTION_NOT_TRADEABLE`, `MISSING_REQUIRED_LEVEL` |
| Quality reasons (typical) | `MISSING_ENTRY`, `MISSING_STOP`, `MISSING_TP1`, `DECISION_WAIT`, `WAIT_NO_VALID_PLAN`, `TRADE_LEVELS_FAILED_SAFETY_VALIDATION`, `AWAITING_5M_CONFIRMATION`, `MISSING_4H_CONTEXT`, … |

### Validator replay on production candidates

No BUY/SELL candidates with levels existed in the windows, so current vs proposed validator **accepted=0 / rejected=0** for directional geometry. Classification changes: **0**.

## Cause checklist

| Hypothesis | Verdict |
| --- | --- |
| No Pine 3.0 PLAN_15M events | **YES — primary** |
| Legacy Pine 2.x data only | **YES** (2.0.4 / schema 1.0) |
| Missing required payload fields | **YES** on all plan-source events (no entry/stop/TP1) |
| Structure-incomplete rule | Code risk; not the live wipe cause (no levels to wipe) |
| TP2 requirement | Not observed in live plan-source payloads (no TP1 either) |
| Quick-target failure | Code risk when levels exist; **0** live candidates |
| Min room / RR | Not exercised live |
| Price already at target | Not exercised live |
| Invalidation mismatch | Not exercised live |
| Stale data | Not the NO_VALID_PLAN message path for active plans |
| Role/timeframe mismatch | `chartMatchesRole` null; roles mostly UNKNOWN/LEGACY |
| Another defect | Live alerts still on Bridge **2.0.4**, not canonical **3.0.0** |

## Pine 3.0 data-flow status

| Expected field | Production status |
| --- | --- |
| `scriptVersion` 3.0.0 | **Not received** (2.0.4 only) |
| `schemaVersion` 1.1 | **Not received** (1.0 only) |
| `alertRole` PLAN_15M | **0 events** |
| `alertRole` CONFIRM_5M | **0 events** |
| `alertRole` QUOTE_1M | **0 events** (legacy untyped bars instead) |
| `timeframe` 15 + confirmed | 15m bars arrive, but without plan levels |
| `chartMatchesRole` | null |
| `planSourceKey` | absent |
| 4H / 1H / 15M structure + entry/stop/targets | **absent** on plan-source events |

Canonical Pine script in repo: `pine/GoldMetaBridge.pine` (**3.0.0**, schema 1.1).  
**Manual TradingView alert replacement is required** (do not auto-modify live alerts).

## Code over-block risks (fix in this change)

When Entry/Stop/TP1 **do** exist, current code can still force `NO_VALID_PLAN`:

1. `QUICK_TARGET_FAILED` → `actionable=false` even if engine TP1 is valid  
2. `STRUCTURE_INCOMPLETE` fatal for `LIVE_RANGE_ONLY` / optional profile gaps  
3. `planQuality` requires POC/VAH/VAL + often confirmation for anything above `NO_PLAN`  
4. `applyGeometrySafetyGate` **strips** direction/levels on soft failures  
5. Decision `hardGuards` require TP2 RR ≥ 1.5 and volume profile / confirmation before BUY/SELL

These are corrected by splitting **hard blockers** vs **soft limitations** (see PR). Soft paths must show **VALID PLAN — WAITING** / **PLAN READY — WAIT FOR ENTRY ZONE**, not NO VALID PLAN.

## Hard blockers (remain NO_VALID_PLAN / NO_TRADE)

- missing direction / entry / stop / TP1  
- entry ≈ stop / zero risk  
- stop or TP1 wrong side  
- invalid entry zone  
- price already past TP1 before confirmation  
- stale required data / price-source mismatch  
- chart/timeframe-role mismatch (`chartMatchesRole === false`)  
- invalidation text disagrees with numeric stop  

## Soft limitations (preserve levels)

- TP2/TP3 missing  
- optional POC/VAH/VAL / TPO / volume-profile gaps  
- no 5M confirmation yet  
- price outside entry zone  
- quick-target candidate fails but valid structural/engine TP1 exists  
- plan quality B / cautious  
- optional 4H strength unavailable  

## Manual TradingView action required

1. Update indicator to **GoldMeta Bridge 3.0.0** from `pine/GoldMetaBridge.pine`.  
2. Create **three** alerts (same webhook URL / secret as today):  
   - 15m chart → Alert Role **PLAN_15M**  
   - 5m chart → Alert Role **CONFIRM_5M**  
   - 1m chart → Alert Role **QUOTE_1M**  
3. Confirm webhook JSON includes `metadata.alertRole`, `metadata.scriptVersion=3.0.0`, `schemaVersion=1.1`, `planSourceKey`, `chartMatchesRole`, entry/stop/TP candidates.  
4. Do **not** expect CONFIRM_5M to create levels.  
5. Leave AutoTrade / Demo / Live execution OFF.

## Safety

- AutoTrade OFF · Demo submission OFF · Live execution OFF · no orders  
- Firebase Auth untouched  
- Geometry safety for wrong-side / zero-risk / mismatch retained  
