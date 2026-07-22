# V6 IG Demo read-only connection — delivery notes

**Branch:** `cursor/goldmeta-v6-ig-autotrade-c2c2`  
**PR:** #21 (do not merge / do not promote)  
**Approved base:** `4621156`  
**Reviewed head (this pass started from):** `928e1f9`  
**Current tip:** `9aeae43161be908096bd07d2ee669f094c82fc95`  

**V6 frontend preview:** https://preview-v6-autotrade.goldmeta-web.pages.dev  
**UI review:** https://preview-v6-autotrade.goldmeta-web.pages.dev/ui-review/autotrade  

## Isolated preview backend

| Item | Value |
|------|-------|
| Function name | `apiV6Preview` |
| Deploy | `firebase deploy --only functions:apiV6Preview` (Savio only — agent does not deploy) |
| URL | `https://us-central1-goldmeta-web.cloudfunctions.net/apiV6Preview` |
| Production `api` | **Untouched** — no IG Demo `defineSecret` / `secrets` binding |
| Preview Firestore ns | `users/{userId}/autoTradePreview/workspace/...` |
| Preview frontend API | Built with `VITE_API_BASE_URL=…/apiV6Preview` |

## Safety flags (hard-coded / preview-forced)

- `DEMO_ORDER_SUBMISSION_ENABLED=false`
- `LIVE_EXECUTION_FEATURE_FLAG=false`
- Dealing methods on `IgBrokerAdapter` throw `DEMO_ORDER_SUBMISSION_DISABLED`
- LIVE connect / adapter factory blocked
- Automated tests use injected `fetch` mocks or `FakeIgBrokerAdapter` only — no real IG network

## Host isolation

- Demo runtime base: `https://demo-api.ig.com/gateway/deal`
- Live base constant exists for docs/tests only: `https://api.ig.com/gateway/deal`
- DEMO adapter `baseUrl()` always returns the Demo host and cannot switch to Live

## Read-only IG endpoints reachable (Demo host only)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/session` | Create Demo session |
| `GET` | `/session` | Heartbeat / session check |
| `PUT` | `/session` | Switch account **only when not already active** |
| `DELETE` | `/session` | Logout / clear tokens |
| `GET` | `/accounts` | List accounts + balance |
| `GET` | `/markets?searchTerm=…` | Spot Gold / XAUUSD search |
| `GET` | `/markets/{epic}` | Market details + dealing rules |
| `GET` | `/positions` | Open positions (read-only) |
| `GET` | `/confirms/{dealReference}` | Confirm lookup (not used by read-only diagnostics) |

**Not reachable while flags remain false (and not called by diagnostics):**

- `POST /positions/otc`
- `DELETE /positions/otc/{dealId}`
- `PUT /positions/otc/{dealId}`
- Any `/working-orders` endpoints
- Any Live host (`https://api.ig.com/gateway/deal`)

## Secrets (Firebase Secret Manager only — names only)

`IG_DEMO_API_KEY`, `IG_DEMO_USERNAME`, `IG_DEMO_PASSWORD`, `IG_DEMO_ACCOUNT_ID`

Bound **only** to `apiV6Preview` via `defineSecret`. Production `api` does not receive them.  
See `docs/V6_IG_DEMO_SECRETS_SETUP.md`.

## Test totals (this tip)

| Suite | Total |
|-------|-------|
| Backend | 217 |

## Real IG Demo result

**Pending Savio:** set secrets via Firebase CLI and deploy `apiV6Preview` only.  
This agent does not deploy. Until then, preview backend fails closed (no silent FakeIg on `apiV6Preview`). Mocked diagnostics prove host isolation, login headers, skip unnecessary account switch, account mismatch lock, redaction, dealing block, and flag safety.
