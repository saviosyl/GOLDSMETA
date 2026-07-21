# Phase 3 Stage 2 — Frontend deploy & clean PR report

**Date:** 2026-07-21  
**Backend (live):** `1.2.0-phase3`  
**Clean review branch:** `cursor/phase3-clean-c2c2`  
**Clean PR:** https://github.com/saviosyl/GOLDSMETA/pull/8 (draft)  
**Original PR #7:** remains open, not merged — https://github.com/saviosyl/GOLDSMETA/pull/7

---

## TASK A — Production web deploy

### Result: **PASS**

| Item | Status |
|------|--------|
| Cloudflare token scope | Pages project `goldmeta-web` read/deploy OK; zone cache purge **not** permitted (expected) |
| Pages project | Existing `goldmeta-web` (not recreated) |
| Production branch deploy | `--branch cursor/production-connection` |
| Custom domain | `https://goldmeta.metamechsolutions.com` |
| pages.dev | `https://goldmeta-web.pages.dev` |

### Deployed asset hashes (production)

- JS: `index-C2elnKhj.js`
- CSS: `index-CS_3VQyW.css`

Old Phase 2 hashes gone from HTML:

- ~~`index-H3wkx3nm.js`~~
- ~~`index-QeQ_TMyx.css`~~

Note: first deploy briefly poisoned custom-domain edge cache for previous hashes (`index-DIsBlidJ.js` / `index-D674XCiC.css` served as SPA HTML). Redeploy with new content hashes resolved MIME types without zone purge.

---

## TASK B — Authenticated production UI

Verified signed-in on `https://goldmeta.metamechsolutions.com`.

| Area | Result |
|------|--------|
| Dashboard pipeline strip | PASS — TradingView ACTIVE, Analysis only, Active setup None |
| Backend version | PASS — Diagnostics shows `1.2.0-phase3` |
| TEST setup tracking | PASS via API flags `setupTrackingEnvironments: ["TEST"]`; Diagnostics UI does not yet print the flag list (see remaining) |
| LIVE decisions separate | PASS — LIVE badges on live decisions; setups labelled TEST |
| No false live-price claim | PASS |
| History lifecycle filters | PASS — All/BUY/SELL/WAIT/Active/Won/Lost/Expired/LIVE/TEST |
| WAIT has no setup | PASS — 0 `/setups/` links under WAIT filter |
| Setup WIN_TP3 | PASS — raw `4R` / modelled `2.7R` (`81b60215cf7dfe1ad12392f1`) |
| Setup LOSS_SL | PASS — `-1R` (`f91ef1d3343664b4e5a91d46`) |
| Setup EXPIRED | PASS (`4925db514f020e9893bb2bb9`) |
| Setup AMBIGUOUS_WORST_CASE_SL | PASS — `-1R` (`0dab119fa6805cc627427b7e`) |
| Analytics TEST | PASS — n=12, small-sample warning |
| Analytics LIVE | PASS — completed 0 / n=0 |
| No profitability claim | PASS — “not statistically significant / not proven” |
| Diagnostics | PASS — secrets not shown (`Secret present: yes` only); recent rejects listed; not admin-claim-gated |
| Journal | PASS — notes/tags save; “never alter engine outcomes” |

### Hotfix shipped during verification

`GET /v1/decisions/:id` failed in production (collection-group query). Fixed to user-scoped doc path and redeployed Functions. Setup detail page also tolerates optional decision-link failure.

---

## TASK C — Responsive

Widths 320 / 375 / 390 / 430 / 768 / 1024:

- No horizontal overflow
- No nav clipping / content hidden behind navigation

Screenshots: `/tmp/gm-responsive-*.png`, `/tmp/gm-setup3-*.png`

---

## TASK D — PWA / cache

| Check | Result |
|-------|--------|
| CSS `Content-Type` | `text/css; charset=utf-8` |
| JS `Content-Type` | `application/javascript` |
| Service worker | Registered; controller `…/sw.js` |
| Hard refresh Phase 3 UI | PASS (new hashes) |

---

## TASK E — LIVE regression

| Check | Result |
|-------|--------|
| LIVE webhook POST | **202** queued (`2HBnvhqE6XQPJF4roWCQUx6E` kept active) |
| Decision created | LIVE `WAIT` `c2b7a020432219e725ed4e2c` |
| LIVE setups | **0** (before and after) |
| TEST analytics | unchanged (n=12) |
| Broker | `BROKER_MODE=DISABLED`, `brokerExecutionEnabled=false` |
| Setup tracking | `SETUP_TRACKING_ENVIRONMENTS=["TEST"]` only |

---

## TASK F — PR review state

| PR | State | Action |
|----|-------|--------|
| #8 clean Phase 3 | **Draft**, CI Backend+Web green on prior head | Keep draft; safe to mark **ready for review** after CI on latest commits |
| #7 noisy | Open | Keep open until #8 fully verified; **do not merge either** |

### PR #8 recommendation

**Safe to mark ready for review** after the getDecision fix + deploy verification commits land and CI stays green. Prefer #8 over #7 (no `ios/` / `pine/` noise). Do not merge until reviewer sign-off.

---

## Remaining issues

1. Diagnostics page does not render `setupTrackingEnvironments` / flag strip (API has them; UI omits).
2. History `TEST` filter can still show decision cards with a LIVE env badge when the linked decision was LIVE isolation traffic — confirm filter semantics (decision env vs setup env).
3. `GET /v1/setups?environment=` is ignored server-side (list returns all; analytics filters correctly).
4. Diagnostics is authenticated-user scoped, not admin-claim-gated (known Phase 3 limitation).
5. Custom-domain edge can cache SPA HTML for brand-new `/assets/*` URLs during deploy races; prefer content-hash redeploy or a token with Cache Purge if it recurs.
6. Primary test account password was rotated for agent sign-in — owner should reset via Firebase Auth if needed.

---

## Constraints preserved

- `SETUP_TRACKING_ENVIRONMENTS=TEST`
- `BROKER_MODE=DISABLED`
- `AI_ENABLED=false`
- No LIVE setup tracking enablement
- No IG connection
- No merge of PR #7 or #8
- No `ios/` / `pine/` / DNS changes
