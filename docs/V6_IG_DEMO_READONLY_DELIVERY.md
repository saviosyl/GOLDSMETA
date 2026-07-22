# V6 IG Demo read-only connection — delivery notes

**Branch:** `cursor/goldmeta-v6-ig-autotrade-c2c2`  
**PR:** #21 (do not merge / do not promote)  
**Approved base:** `4621156`  
**Previous approved tip:** `dd87b0b`

## Isolated preview backend

| Item | Value |
|------|-------|
| Function name | `apiV6Preview` |
| Deploy | `firebase deploy --only functions:apiV6Preview` |
| URL | `https://us-central1-goldmeta-web.cloudfunctions.net/apiV6Preview` |
| Production `api` | **Untouched** — not redeployed by the preview-only command |
| Preview Firestore ns | `users/{userId}/autoTradePreview/workspace/...` |

## Safety flags (hard-coded / preview-forced)

- `DEMO_ORDER_SUBMISSION_ENABLED=false`
- `LIVE_EXECUTION_FEATURE_FLAG=false`
- Dealing methods on `IgBrokerAdapter` throw `DEMO_ORDER_SUBMISSION_DISABLED`
- LIVE connect blocked
- Automated tests use `FakeIgBrokerAdapter` only

## Secrets (Firebase Secret Manager only)

`IG_DEMO_API_KEY`, `IG_DEMO_USERNAME`, `IG_DEMO_PASSWORD`, `IG_DEMO_ACCOUNT_ID`

Bound only to `apiV6Preview`. See `docs/V6_IG_DEMO_SECRETS_SETUP.md`.

## Real IG Demo result

Cannot complete live IG authentication until Savio sets secrets locally via Firebase CLI
and deploys `apiV6Preview`. Until then, preview fails closed (no silent FakeIg on
`apiV6Preview`).
