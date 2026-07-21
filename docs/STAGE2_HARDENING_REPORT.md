# Phase 3 Stage 2 — Final hardening report

**Date:** 2026-07-21  
**Head:** `cursor/phase3-clean-c2c2`  
**PR #8:** https://github.com/saviosyl/GOLDSMETA/pull/8  
**PR #7:** kept open, not merged

## Fixes shipped

1. **Diagnostics flags** — render `setupTrackingEnabled`, `setupTrackingEnvironments`, `brokerMode`, `aiEnabled`, backend + rule versions from API `flags` (not hard-coded).
2. **History LIVE/TEST** — filter on authoritative `decision.environment`; show env badge; rename data-quality label `LIVE` → `FRESH` to avoid confusion.
3. **Server setups filter** — `GET /v1/setups?environment=TEST|LIVE` enforced in store/query; invalid → 400.
4. **Admin-gated diagnostics** — Firebase claim `admin=true`; 401 unauth / 403 non-admin; frontend forbidden state.
5. **Pages asset race** — `index.html`/`/`/`sw.js` `no-cache`; `/assets/*` immutable long-cache; missing `/assets/*` → 404 (not SPA HTML); `web/scripts/post-deploy-check.mjs`.
6. **Credential cleanup** — temp password/token files removed; CF token unset after deploy; no secrets committed.

## Production verification (2026-07-21)

| Check | Result |
|-------|--------|
| Diagnostics shows `["TEST"]` | PASS |
| Non-admin diagnostics | **403 FORBIDDEN** |
| Admin diagnostics | **200** |
| `/v1/setups?environment=TEST` | 12 TEST-only |
| `/v1/setups?environment=LIVE` | 0 LIVE |
| invalid environment | **400** |
| decision detail | PASS |
| assets MIME | JS `application/javascript`, CSS `text/css`; missing → 404 |
| LIVE webhook | **202**, LIVE setups stay 0, TEST n=12 |
| broker | controls auto off; propose rejected; demo preview only |
| Deployed assets | `index-CN9nQqdk.js`, `index-CS_3VQyW.css` |

## Admin claim

Granted for primary uid `iuayfBpUkZYEAlYlsTFxulSC4Ye2`. One-time script:

```bash
cd backend
export GOLDMETA_PROJECT_ID=goldmeta-web
# ADC / service account with Firebase Auth Admin
npx tsx scripts/setAdminClaim.ts --uid iuayfBpUkZYEAlYlsTFxulSC4Ye2
# user must refresh ID token (sign out/in)
```

## Tests / CI

- Backend: lint, build, **101** tests PASS  
- Web: lint, typecheck, **43** tests PASS, production build PASS  
- GitHub CI on PR #8: Backend + Web **success**

## Remaining risks

- Custom-domain edge may briefly serve prior HTML until `no-cache` revalidation; mitigated by hashed assets + asset 404 rule.
- Existing CSS hash may retain older `Cache-Control` at edge until expiry (new JS already `immutable`).
- Primary account password was rotated during agent verification — **Firebase password reset recommended**; revoke other sessions in Firebase Auth console if desired.
- Diagnostics admin claim is global to the user (not per-resource); keep claim limited to operators.

## Recommendation

**PR #8 is ready for human review.** Keep draft→ready after CI green. Do not merge until reviewer approval. Keep PR #7 open.
