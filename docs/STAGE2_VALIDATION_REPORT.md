# Phase 3 Stage 2 — Controlled TEST-only validation

**Date:** 2026-07-21  
**Commit deployed:** `1265e676f967cd25797ef36e9e49fd3339e948b4`  
**PR:** https://github.com/saviosyl/GOLDSMETA/pull/7 (draft — not merged)  
**Backend version:** `1.2.0-phase3`  
**Rule config:** `rules-1.1.0` / setup `setup-rules-1.0.0`

## 1. Final PR review (before deploy)

### Phase 3 commit scope (`271438c` → `1265e67` vs parent `5b38d3d`)

- **No `ios/` changes** in Phase 3 commits
- **No `pine/` changes** in Phase 3 commits
- No secrets committed (`.env` gitignored; `.env.example` has non-secret Stage 2 flag names only)
- Live broker execution hard-disabled; `BROKER_MODE=DISABLED` fails closed
- TEST/LIVE analytics strictly separated in `computeSetupAnalytics`
- WAIT creates no setup; max one active setup; duplicate/out-of-order bars idempotent
- Confirmed 15m bars only; same-candle uses `WORST_CASE_SL_FIRST`
- Decision pipeline unchanged except non-fatal setup hooks
- Firestore rules: owner read on `setups`; writes server-only
- Indexes: setups composites deployed

### Unrelated files in PR #7 vs `main`

**Reported before proceeding:** PR #7 against `main` includes historical `ios/`, `pine/`, and prior production commits that predate Phase 3 (branch ancestry from production-connection / webhook-delivery). Those files were **not** modified by Phase 3. Prefer retargeting PR base to `cursor/webhook-delivery-400-c2c2` or `cursor/production-connection` before merge review so the diff is Phase-3-only.

## 2. Deployed environment flags

Loaded from Functions `.env` at deploy:

| Flag | Value |
|------|-------|
| `SETUP_TRACKING_ENABLED` | `true` |
| `SETUP_TRACKING_ENVIRONMENTS` | `TEST` |
| `NEW_SETUP_CREATION_ENABLED` | `true` |
| `ANALYSIS_GENERATION_ENABLED` | `true` |
| `BROKER_EXECUTION_ENABLED` | `false` |
| `BROKER_MODE` | `DISABLED` |
| `AI_ENABLED` | `false` |
| `brokerLiveExecutionEnabled` | `false` (hard) |

## 3. Firestore changes deployed

- `firestore.rules` (setups owner-read)
- `firestore.indexes.json` (setups composites)
- Functions: `api`, `processProcessingJob`

Firebase Hosting: **not** deployed.

## 4. Fixture results A–H

All service-layer fixtures against user `iuayfBpUkZYEAlYlsTFxulSC4Ye2`:

| Scenario | Result | Setup ID / notes |
|----------|--------|------------------|
| A BUY full lifecycle | PASS | `81b60215cf7dfe1ad12392f1` → `WIN_TP3`, rawR=4, modelledR=2.7 |
| B SELL → SL | PASS | `f91ef1d3343664b4e5a91d46` → `LOSS_SL`, rawR=-1 |
| C WAIT | PASS | no setup created |
| D expiry | PASS | `4925db514f020e9893bb2bb9` → `EXPIRED` |
| E ambiguous | PASS | `0dab119fa6805cc627427b7e` → `AMBIGUOUS_WORST_CASE_SL`, rawR=-1 (not a win) |
| F duplicate bar | PASS | `10b6d4e74ae44c24748361ac` — one apply, one ENTRY transition |
| G active guard | PASS | second setup blocked; activeCount=1 |
| H LIVE isolation | PASS | LIVE BUY decision saved; **no** setup; tracking envs=`TEST` |

Webhook regression:

| Check | Result |
|-------|--------|
| TEST webhook POST | **202** → TEST WAIT decision |
| LIVE webhook POST | **202** → LIVE WAIT decision |
| LIVE setup creation | **none** (`liveSetupCount=0`) |
| Broker placeDemoOrder | rejected (`DEMO_BROKER_DISABLED`) |

## 5. Analytics (TEST vs LIVE)

After fixtures (approximate):

- TEST: completed setups present; small-sample warning shown (`n<30`)
- LIVE setups: **0** — TEST cannot contaminate LIVE statistics

## 6. Frontend deployment

**Blocked in this environment:** `CLOUDFLARE_API_TOKEN` not available; `wrangler whoami` unauthenticated.

Local verification completed:

- lint / typecheck / 40 tests / production build — **pass**
- Built with `VITE_API_BASE_URL=https://us-central1-goldmeta-web.cloudfunctions.net/api`

To deploy Pages (manual):

```bash
cd web
# ensure Production env vars in Cloudflare dashboard include production VITE_API_BASE_URL
npx wrangler pages deploy dist --project-name goldmeta-web
```

Do **not** use Firebase Hosting.

### Frontend verification pending Pages deploy

Once Pages is updated to commit `1265e67`, verify Dashboard/History/Setup/Analytics/Diagnostics/Journal as listed in the Stage 2 brief. Diagnostics today are **authenticated-user** scoped (not admin-claim-restricted yet) — secrets are not exposed.

## 7. LIVE pipeline regression

- Existing LIVE decisions continue (pre-deploy BUY/WAIT history intact)
- Synthetic LIVE BAR_CLOSE → **202**, WAIT decision created, **no setup**
- Duplicate event path unchanged (stable event IDs)
- Broker not invoked

## 8. Quality / CI (head `1265e67`)

| Check | Result |
|-------|--------|
| Backend lint | pass |
| Backend build | pass |
| Backend tests | **90** passed |
| Web lint | pass |
| Web typecheck | pass |
| Web tests | **40** passed |
| Web production build | pass |
| GitHub Actions Backend | success |
| GitHub Actions Web PWA | success |
| GitHub Actions iOS | (ran; Phase 3 did not change ios/) |

## 9. Security findings

- No webhook secrets in diagnostics responses (`hasSecret` boolean only)
- No IG credentials / no live endpoints callable for execution
- `placeDemoOrder` fail-closed under `BROKER_MODE=DISABLED`
- Setup creation skipped for LIVE under Stage 2 flags (logged)

## 10. Recommendation

- **Stage 2 backend validation: successful** — keep TEST-only tracking
- **Do not enable `TEST,LIVE` yet**
- **Do not merge PR #7 yet**
- **Do not connect IG**
- Before marking PR ready for review: retarget base away from `main` (or rebase) so the diff excludes historical `ios/`/`pine/` ancestry; deploy web via Cloudflare when token available; then UI-verify against the TEST fixtures above
- After UI verify: Stage 3 = set `SETUP_TRACKING_ENVIRONMENTS=TEST,LIVE` in a separate controlled change
