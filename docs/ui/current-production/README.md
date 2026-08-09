# GoldMeta — Current Production UI Audit Package

Read-only visual capture of the **live** production application for page-by-page review.

| Field | Value |
| --- | --- |
| Production URL | https://goldmeta.metamechsolutions.com |
| Production build SHA | `83ff6ee54bedb98e6308040b128ceb6291930672` |
| Capture date/time (UTC) | 2026-08-09 (session ~08:06–08:20 UTC) |
| Desktop viewport | 1440 × 1000 |
| Mobile viewport | 430 × 932 |
| Capture mode | Playwright Chromium, full-page PNG |
| Auth | Existing OWNER production account (custom-token session; no password used; token not stored) |
| Production mutations | **None** (navigation / screenshot only) |

## Folders

| Folder | Contents |
| --- | --- |
| `desktop/` | Normal user + public auth desktop full-page screenshots |
| `mobile/` | Normal user + public auth mobile full-page screenshots (+ MORE sheet) |
| `admin/` | Admin-only screenshots (labelled ADMIN; not mixed with trader UX) |

## Manifest

| Page | Route | Desktop | Mobile | Capture status | Notes |
| --- | --- | --- | --- | --- | --- |
| Plan | `/` | YES (`01-plan-desktop.png`) | YES (`01-plan-mobile.png`) | Captured | Chart loaded (VAH/POC/VAL/Sup/Res visible) |
| Levels | `/levels` | YES | YES | Captured | |
| Markets / Intelligence | `/intelligence` | YES | YES | Captured | |
| Journal | `/journal` | YES | YES | Captured | |
| Alerts | `/alerts` | YES | YES | Captured | |
| Research | `/v4` | YES | YES | Captured | |
| Analytics | `/analytics` | YES | YES | Captured | |
| Performance | `/autotrade/performance` | YES | YES | Captured | Current empty / real state |
| History | `/history` | YES | YES | Captured | List view |
| Replay | `/replay` | YES | YES | Captured | |
| Risk Planner | `/planner` | YES | YES | Captured | |
| AutoTrade | `/autotrade` | YES | YES | Captured | Current qualification · Demo `48…10` · Max trades 6 · Live LOCKED |
| Broker | `/brokers` | YES | YES | Captured | Pepperstone Demo connected · masked account |
| Settings | `/settings` | YES | YES | Captured | |
| Help | `/help` | YES | YES | Captured | |
| Signal Performance | `/signal-performance` | YES | YES | Captured | |
| Analysis | `/analysis` | YES | YES | Captured | Extra normal-user route |
| TradingView Setup | `/tradingview` | YES | YES | Captured | Extra normal-user / owner route |
| Mobile MORE nav | `/` (MORE open) | — | YES (`00-mobile-more-nav-open.png`) | Captured | MORE sheet open |
| History Detail | `/history/:decisionId` | NO | NO | NO REAL PRODUCTION RECORD AVAILABLE | No detail link present in list |
| Setup Detail | `/setups/:setupId` | NO | NO | NO REAL PRODUCTION RECORD AVAILABLE | No setup detail link found |
| Journal Detail | (if separate) | NO | NO | NO REAL PRODUCTION RECORD AVAILABLE | No separate detail route found |
| Sign In | `/` (signed out) | YES (`P01-sign-in-desktop.png`) | YES | Captured | Fresh signed-out context |
| Register | `/register` | YES (`P02-register-desktop.png`) | YES | Captured | Fresh signed-out context |
| Verify Email | `/verify-email` | NO | NO | Skipped | Would require changing account state |
| Awaiting Approval | `/awaiting-approval` | NO | NO | Skipped | Would require changing account state |
| Account Ready | `/account-ready` | NO | NO | Skipped | Would require changing account state |
| Account Suspended | `/account-suspended` | NO | NO | Skipped | Would require changing account state |

### Admin (separate)

| Page | Route | Desktop | Mobile | Capture status | Notes |
| --- | --- | --- | --- | --- | --- |
| Admin Users | `/admin/users` | YES | YES | Captured | ADMIN |
| TradingView Template | `/admin/tradingview-template` | YES | YES | Captured | ADMIN |
| Diagnostics | `/diagnostics` | YES | YES | Captured | ADMIN |

## Counts

| Set | Count |
| --- | --- |
| Desktop PNGs | 20 |
| Mobile PNGs | 21 |
| Admin PNGs | 6 |

## Safety checks

- Sensitive scan for API keys / PEM / refresh tokens in PNG bytes: **clean**
- Masked broker account only (`48…10`)
- No access/refresh tokens, OAuth secrets, or passwords in frames
- Owner email appears only where Admin Users UI already displays it
- Qualification still `PREVIEW_QUALIFICATION`; Demo max trades/day still `6`
- Live execution remains locked in UI

## Reproduce (optional)

Capture tooling (not required for review):

- `capture-audit.mjs` — full pass
- `capture-missing.mjs` — admin mobile / public auth / detail probe

These scripts are **read-only** against production and must never be given committed credentials.
