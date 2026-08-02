# Phase 3 Stage 3 — LIVE forward testing & PWA polish

> **Historical document** (2026-07-21). Describes an earlier Stage 3 forward-test phase.
> Current multi-user AutoTrade / TradingView architecture: [`MULTI_USER_AUTOTRADE_ARCHITECTURE.md`](./MULTI_USER_AUTOTRADE_ARCHITECTURE.md).
> €20 risk figures below are historical test intent / recommended defaults, not permanent product hard caps.

**Date:** 2026-07-21  
**Branch:** `cursor/phase3-stage3-live-forward-c2c2` (`59be940`+)  
**PR:** https://github.com/saviosyl/GOLDSMETA/pull/9 (draft)  
**Backup tag:** `phase3-stage2-pre-stage3-c2c2`  
**Backend version:** `1.3.0-phase3-stage3`  
**PR #7 / #8:** not merged (as requested)

## Intent

GoldMeta remains analysis / decision-support only. Manual execution by the user.  
Maximum intended personal risk: €20 / trade (editable). Broker execution stays hard-disabled.  
No profitability claims.

## Deployed feature flags (Cloud Functions `api`)

| Flag | Value | Verified |
| --- | --- | --- |
| `SETUP_TRACKING_ENVIRONMENTS` | `TEST,LIVE` | Yes (Functions env) |
| `SETUP_TRACKING_ENABLED` | `true` | Yes |
| `BROKER_MODE` | `DISABLED` | Yes |
| `BROKER_EXECUTION_ENABLED` | `false` | Yes |
| `AI_ENABLED` | `false` | Yes |

Health: `GET /health` → `backendVersion: "1.3.0-phase3-stage3"`.

## What shipped (code)

1. LIVE + TEST setup lifecycle tracking (no historical LIVE backfill)
2. Manual €20 risk planner (estimates only; no broker calls)
3. Manual trade journal on LIVE setups (system outcome untouched)
4. Dashboard redesign + one-time LIVE acknowledgement banner
5. GoldMeta brand SVG + full PWA icon set
6. Separate LIVE forward-testing analytics + sample-size bands
7. Editable safety limits with change log

### Logo / icon assets

- `web/public/brand/mark-dark.svg`, `mark-light.svg`, `mark-mono.svg`
- `web/public/brand/logo-horizontal-dark.svg`, `logo-horizontal-light.svg`
- `web/public/favicon.svg`, `favicon.ico`
- `web/public/icons/apple-touch-icon.png` (180)
- `web/public/icons/icon-192.png`, `icon-512.png`, `icon-1024.png`
- `web/public/icons/maskable-icon-192.png`, `maskable-icon-512.png`

### Before / after UI

- **Before:** Compact pipeline card + DecisionCard; no risk planner / LIVE ack / timeline track.
- **After:** Brand header + env/tracking badges, market status, pipeline, LIVE ack, daily risk status, decision, setup timeline, levels, €20 planner, manual journal, recent LIVE signals, disclaimer.

## Tests / CI

| Suite | Result |
| --- | --- |
| Backend vitest | **104 passed** |
| Web vitest | **46 passed** |
| Backend lint/build | pass |
| Web lint / typecheck / production build | pass |
| `ios/` / `pine/` changes | **none** |
| Secrets in commit | **none** |

GitHub Actions on PR #9: triggered by draft PR (monitor Backend/Web workflows).

## Production verification

| # | Check | Result |
| --- | --- | --- |
| 1 | Health Phase 3 version | **PASS** `1.3.0-phase3-stage3` |
| 2 | Tracking envs TEST+LIVE | **PASS** Functions env |
| 3 | Broker mode DISABLED | **PASS** |
| 4 | Existing TEST fixtures | **PASS** Firestore TEST setups = **12** |
| 5 | LIVE analytics / setups | **PASS** LIVE setups = **0** (no backfill) |
| 6 | WAIT creates no setup | Unchanged behaviour (covered by unit tests); no manufactured LIVE signal |
| 7–9 | New LIVE BUY/SELL lifecycle | **Pending** next genuine TradingView LIVE signal |
| 10 | LIVE/TEST filters separate | **PASS** (server filter + UI) |
| 11 | Risk planner no broker | **PASS** (client-only calculator) |
| 12 | Diagnostics admin-only | Unchanged (Stage 2) |
| 13–16 | New PWA icons / installable | **Pending Pages deploy** (token unavailable in agent env) |
| 17 | Missing asset → 404 | Stage 2 hardening still in place on current Pages |
| 18 | No credentials exposed | **PASS** |
| 19 | Broker propose/execute rejected | Code path hard-disabled; authenticated probe blocked (no SA signJwt in env) |
| 20 | LIVE webhook active | **PASS** `2HBnvhqE6XQPJF4roWCQUx6E` ACTIVE |

### Pages deploy blocker

`CLOUDFLARE_API_TOKEN` is not present in this environment (`wrangler whoami` unauthenticated).  
Web build is ready on the Stage 3 branch (`dist` hashes from local build: `index-DL4kS8OM.js`, `index-8UJYn3S-.css`).  
To finish Pages deploy:

```bash
cd web && npm ci && npm run build
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
  npx wrangler pages deploy dist --project-name goldmeta-web --branch cursor/production-connection
node scripts/post-deploy-check.mjs
```

Do **not** modify DNS. Do **not** use Firebase Hosting.

## Remaining risks

- Pages frontend still on Stage 2 assets until CF token deploy
- Custom-domain edge can briefly cache SPA HTML for new asset hashes
- Value-per-point must be user-supplied — wrong values produce unsafe size estimates
- Multiple ACTIVE webhooks exist in Firestore; keep only the intended LIVE URL in TradingView

## First manual €20-risk trade (user steps)

1. After Pages deploy: remove old Home Screen shortcut → clear Safari site data if needed → open production → Add to Home Screen → confirm GoldMeta icon/name.
2. Sign in → acknowledge LIVE forward-testing banner.
3. Wait for a genuine LIVE BUY/SELL (do not invent). WAIT never creates a setup.
4. Use Manual risk planner: set broker **value-per-point** + spread; keep max cash risk ≤ €20.
5. Confirm size / spread / max loss **in the IG order ticket**. GoldMeta does not place the trade.
6. After fill: “I entered this trade” → journal actual entry, size, cash risk.
7. If daily/consecutive limits hit → **STOP TRADING FOR TODAY** (signals still record).

## Broker integration reconsideration

Do **not** reconsider broker API integration before **at least 100 resolved LIVE setups** (sample band `meaningful`), and only after reviewing system vs manual analytics separately. Early positive R is not proof of edge.
