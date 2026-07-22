# V6 IG Demo read-only connection — delivery notes

**Branch:** `cursor/goldmeta-v6-ig-autotrade-c2c2`  
**PR:** #21 (do not merge / do not promote)  
**Approved base:** `4621156`  
**Previous approved tip:** `dd87b0b`  
**Current tip:** `f6c640e`  
**V6 frontend preview:** https://preview-v6-autotrade.goldmeta-web.pages.dev  
**UI review:** https://preview-v6-autotrade.goldmeta-web.pages.dev/ui-review/autotrade  

## Isolated preview backend

| Item | Value |
|------|-------|
| Function name | `apiV6Preview` |
| Deploy | `firebase deploy --only functions:apiV6Preview` |
| URL | `https://us-central1-goldmeta-web.cloudfunctions.net/apiV6Preview` |
| Production `api` | **Untouched** — not redeployed by the preview-only command |
| Preview Firestore ns | `users/{userId}/autoTradePreview/workspace/...` |
| Preview frontend API | Built with `VITE_API_BASE_URL=…/apiV6Preview` |

## Safety flags (hard-coded / preview-forced)

- `DEMO_ORDER_SUBMISSION_ENABLED=false`
- `LIVE_EXECUTION_FEATURE_FLAG=false`
- Dealing methods on `IgBrokerAdapter` throw `DEMO_ORDER_SUBMISSION_DISABLED`
- LIVE connect blocked
- Automated tests use `FakeIgBrokerAdapter` only

## Test totals (this tip)

| Suite | Total |
|-------|-------|
| Backend | 206 |
| Web | 127 |
| Playwright | 72 |

## Secrets (Firebase Secret Manager only)

`IG_DEMO_API_KEY`, `IG_DEMO_USERNAME`, `IG_DEMO_PASSWORD`, `IG_DEMO_ACCOUNT_ID`

Bound only to `apiV6Preview`. See `docs/V6_IG_DEMO_SECRETS_SETUP.md`.

## Real IG Demo result

**Pending Savio:** set secrets via Firebase CLI and deploy `apiV6Preview` only.  
This agent environment has no Firebase deploy token. Until then, preview backend
fails closed (no silent FakeIg on `apiV6Preview`). Mocked diagnostics prove the
read-only path, redaction, account mismatch lock, and dealing block.
