# GoldMeta V5.1 — Production readiness, honest audit & frontend hardening

**Date:** 2026-07-21  
**Draft PR:** https://github.com/saviosyl/GOLDSMETA/pull/12  
**Branch:** `cursor/goldmeta-v5-intelligence-c2c2`  
**Base:** `cursor/goldmeta-v4-stage-b-c2c2`  
**Backend (deployed):** `1.4.0-v5-intelligence` (unchanged this pass — frontend/honesty/hardening focus)  
**Pre-V5.1 tip (document before deploy):** `998cd7f`  
**V5.1 production frontend candidate commit:** _(see latest commit on this branch after merge of this report)_

---

## 1. Branch structure

| Item | Value |
| --- | --- |
| Stage B base | `cursor/goldmeta-v4-stage-b-c2c2` |
| V5 branch | `cursor/goldmeta-v5-intelligence-c2c2` |
| Draft PR | #12 |
| Not combined | PR #10 / #11 histories left separate |
| ios/ | untouched |
| Auto-merge | **not** performed |
| Stripe / public subscription | **not** started |

---

## 2. Cloudflare deployment audit

| Item | Result |
| --- | --- |
| Pages project | **`goldmeta-web`** (existing) |
| Production URL | https://goldmeta.metamechsolutions.com |
| Method | Wrangler CLI and/or Git-connected Pages (see `docs/CLOUDFLARE_PAGES_DEPLOY.md`) |
| Preview URL | **Not created** — `CLOUDFLARE_API_TOKEN` missing in agent env |
| Production deploy | **Blocked** on same secret |
| Secret required | GitHub secret name: **`CLOUDFLARE_API_TOKEN`** |
| Account | `CLOUDFLARE_ACCOUNT_ID` present |
| Min token perms | Account → Cloudflare Pages → Edit |
| DNS / Workers / MetaMech sites | **not** modified |

**Single remaining blocker for frontend production release:** add `CLOUDFLARE_API_TOKEN` securely (never paste into chat/source), then deploy PR #12 as Pages preview → smoke → promote.

---

## 3. Frontend production build

| Check | Result |
| --- | --- |
| `npm ci` / lockfile install | OK (existing `node_modules`) |
| web lint | PASS |
| web typecheck | PASS |
| web tests | **64** PASS |
| production build | PASS |
| API target | `https://us-central1-goldmeta-web.cloudfunctions.net/api` only |
| localhost API | none (Firebase SDK internal `http://localhost` popup defaults only) |
| TEST endpoints exposed | none as API base |
| Firebase admin / CF token / backend secrets in JS | **none found** |
| Private `/v1/decisions` SW runtime cache | **removed** |

### Bundle size (before → after)

| Asset | Before (V5 tip) | After V5.1 |
| --- | --- | --- |
| Main JS | **465.58 kB** (gzip 133.71) | **433.27 kB** (gzip 128.06) |
| CSS | 16.10 kB | 17.42 kB |
| Code-split chunks | none | Intelligence 8.3 · Analytics 5.8 · Replay 4.0 · V4 12.2 · Settings 13.5 kB |

---

## 4. Routing / deep links

SPA `_redirects`: `/* → /index.html 200` (assets excluded via `/assets/* → 404`).  
Routes covered: `/`, `/intelligence`, `/analytics`, `/replay`, `/v4`, `/settings`, auth shell, not-found → home.  
Lazy routes wrapped in Suspense + `RouteErrorBoundary`.  
Signed-out users see auth shell only (`data-testid="signed-out-shell"`).

---

## 5. Honest capability audit

| Feature | Truth status |
| --- | --- |
| Screenshot | **Screenshot Comparison — Beta** — structured user observations vs verified data; **no vision OCR**; cannot create/modify setups. Flag: `VITE_V5_SCREENSHOT_COMPARISON_ENABLED` / backend `V5_SCREENSHOT_COMPARE_ENABLED` |
| Ask GoldMeta | **Deterministic / rules-based / templated** (`implementationType: deterministic_rules_templated`). **Not** an LLM. `AI_ENABLED=false` |
| Offline | Offline banners state LIVE verification unavailable; cached data may be stale; never labelled as current LIVE |

---

## 6–7. Verified data & GoldMeta Score

- Shared `VerifiedDataMeta` chrome: symbol, TF, timestamp, environment, strategy version, mode, freshness (VERIFIED / STALE / PARTIAL / UNAVAILABLE / SHADOW / TEST / OFFLINE / LIVE).  
- Score disclaimer (exact intent): *“GoldMeta Score is a rules-based setup-quality measurement. It is not the probability of a profitable trade.”*  
- Missing components receive **partial credit only** (unit-tested).  
- Score card on daily briefing; V4 plans unchanged.

---

## 8. Performance hardening

- `React.lazy` for Intelligence, Analytics, Replay, V4 Research, Settings.  
- Loading / error-boundary / retry / empty states.  
- Replay: max 60 frames, window page size 12, abandoned-request abort, honest empty history.  
- Stale request guards on briefing / intelligence loads.

---

## 9. PWA / cache safety

| Item | Result |
| --- | --- |
| Manifest / icons | retained |
| `runtimeCaching` of private API | **empty** (no public cache of user decisions) |
| `cleanupOutdatedCaches` | true |
| `skipWaiting` | false (prompted update) |
| Update UX | “A new version of GoldMeta is available — Update now” — does not force-refresh during journal focus |
| HTML/SW Cache-Control | `no-cache` via `_headers` |

---

## 10. Responsive / a11y

- Breakpoint CSS for 320 / 375; focus-visible gold outline; reduced-motion disables V5 animations; nav aria-label; touch-friendly chips/buttons.  
- No design-system rewrite — premium dark/gold language preserved.

---

## 11. Security / user scoping

- All `/v1/v5/*` require auth (integration-tested).  
- User A cannot read User B journal notes or B-only rejection reasons via intelligence/replay.  
- Admin diagnostics remain 403 for normal users.  
- LIVE vs TEST analytics filters separated.  
- Frontend route hiding is **not** the only control.

---

## 12. V3 / V4 non-regression

| Check | Result |
| --- | --- |
| Backend suite (includes V3/V4/webhook) | **149** PASS |
| V5 mutates V4 plans | **no** (isolation test) |
| Broker | DISABLED |
| Actionable V4 | still false |
| BUY NOW / SELL NOW | not introduced |
| unsafe-plan / plan-mutation counts | **0** in V5 paths |

---

## 13. Production smoke

**Not executed against production Pages** — blocked on `CLOUDFLARE_API_TOKEN`.  
Backend V5 APIs remain on Functions at the production API URL above.

---

## 14. Tests & CI

| Suite | Total |
| --- | --- |
| Backend | **149** |
| Web | **64** |
| Backend lint / build | PASS |
| Web lint / typecheck / build | PASS |
| CI on PR #12 | re-trigger after push |

New coverage: honesty labels, score disclaimer, offline stale, screenshot beta, lazy/error boundary, replay windowing, PWA cache safety, V5 object-level isolation, missing-score components.

---

## 15. Recommendation before V6 commercial work

1. Add `CLOUDFLARE_API_TOKEN` → deploy **preview** of PR #12 → full smoke on preview → promote to `goldmeta.metamechsolutions.com`.  
2. Keep V4 SHADOW-only and broker DISABLED until Stage B LIVE evidence review is explicitly signed off.  
3. Do **not** start Stripe/public subscription until V5.1 production smoke (items 1–20 in the brief) is green.  
4. Vision OCR / optional AI narration remain separately reviewed future work (`AI_ENABLED=false`).

**Do not enable broker execution. Do not enable automatic trading. Do not claim profitability. Do not merge automatically.**
