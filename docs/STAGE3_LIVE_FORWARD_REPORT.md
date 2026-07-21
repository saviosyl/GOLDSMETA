# Phase 3 Stage 3 — LIVE forward testing & PWA polish

**Branch:** `cursor/phase3-stage3-live-forward-c2c2`  
**Backend version:** `1.3.0-phase3-stage3`  
**Backup tag:** `phase3-stage2-pre-stage3-c2c2`

## Intent

GoldMeta remains analysis / decision-support only. Manual execution by the user.
Maximum intended personal risk: €20 / trade (editable). Broker execution stays hard-disabled.
No profitability claims.

## Feature flags (production target)

| Flag | Value |
| --- | --- |
| `SETUP_TRACKING_ENVIRONMENTS` | `TEST,LIVE` |
| `BROKER_MODE` | `DISABLED` |
| `AI_ENABLED` | `false` |
| `BROKER_EXECUTION_ENABLED` | `false` |

## What shipped

1. LIVE + TEST setup lifecycle tracking (no historical LIVE backfill)
2. Manual €20 risk planner (estimates only; no broker calls)
3. Manual trade journal on LIVE setups (system outcome untouched)
4. Dashboard redesign + LIVE acknowledgement banner
5. GoldMeta brand SVG + full PWA icon set
6. Separate LIVE forward-testing analytics + sample-size bands
7. Editable safety limits with change log

## Tests

- Backend: 104 passed
- Web: 46 passed
- Lint / typecheck / production build: pass
- No `ios/` or `pine/` changes

## User first €20 manual trade steps

1. Open https://goldmeta.metamechsolutions.com in Safari; re-add Home Screen shortcut for new icon
2. Acknowledge the LIVE forward-testing banner
3. Wait for a genuine LIVE BUY/SELL (do not invent signals); WAIT creates no setup
4. Open Manual risk planner — enter broker value-per-point and spread; keep max risk ≤ €20
5. Confirm size / spread / max loss in the IG ticket — GoldMeta does not place the trade
6. After filling, use “I entered this trade” and journal actual entry / size / risk
7. Respect STOP TRADING FOR TODAY when daily/consecutive limits hit

## Broker integration reconsideration

Do **not** reconsider broker API integration before **at least 100 resolved LIVE setups** with meaningful sample-size band, and preferably after reviewing system vs manual analytics separately. Early positive R is not proof of edge.

## Remaining risks

- Custom-domain edge can briefly cache SPA HTML for new asset hashes
- Value-per-point must be user-supplied — wrong values produce unsafe size estimates
- LIVE setups only start after deploy; historical LIVE decisions are not backfilled
- PR #7 stays draft; PR #8 stays unmerged unless human review approves
