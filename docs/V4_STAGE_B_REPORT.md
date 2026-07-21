# GoldMeta V4 Stage B — LIVE Shadow Validation Checkpoint

**Date:** 2026-07-21  
**Branch:** `cursor/goldmeta-v4-stage-b-c2c2`  
**Production-compatible base:** `95775dc` (`cursor/phase3-stage3-live-forward-c2c2`)  
**Backend version:** `1.3.1-v4-stage-b`  
**V4 engine:** `1.1.0-v4-stage-b` / config `v4-config-1.1.0-stage-b`

## Clean replacement PR

- **Replacement draft PR:** https://github.com/saviosyl/GOLDSMETA/pull/11
- **Keep PR #10 open** (Stage A ancestry on `main` is broad): https://github.com/saviosyl/GOLDSMETA/pull/10
- This Stage B branch is cut from production Stage 3 tip `95775dc`, then Stage A V4 + Stage B shadow work only.
- Clean delta vs `95775dc`: **48 files**, **no `ios/` / `pine/`**.

## Deployed backend

- **Version:** `1.3.1-v4-stage-b`
- **API:** `https://us-central1-goldmeta-web.cloudfunctions.net/api`
- **Health:** `{"ok":true,"backendVersion":"1.3.1-v4-stage-b",...}`
- **Auth:** `/v1/v4/*` and system diagnostics return 401 without auth (expected)
- **Web Pages:** not redeployed (no `CLOUDFLARE_API_TOKEN` in this environment)

## Diff scope (included)

V4 research engine + Stage B shadow lifecycle under `backend/src/services/v4/`, storage methods, `/v1/v4/*` routes, diagnostics flags, `/v4` research UI, historical importer + docs, Stage B tests.

## Diff scope (excluded)

- `ios/`, `pine/`
- Secrets / credentials
- Unrelated infrastructure / obsolete Phase 1–2 trees
- Broker execution enablement
- Actionable V4 notifications or LIVE setup creation

## Feature flags (fail-closed)

| Flag | Value |
| --- | --- |
| `V4_SHADOW_COMPUTE_ENABLED` | `true` |
| `V4_SHADOW_LIFECYCLE_ENABLED` | `true` |
| `V4_SHADOW_PERSIST_ENABLED` | `true` |
| `V4_ACTIONABLE_SETUP_ENABLED` | `false` (hard-off in code) |
| `V4_LIVE_SETUP_CREATION` | `false` (hard-off in code) |
| `V4_NOTIFICATIONS_ENABLED` | `false` (hard-off in code) |
| `V4_DEPLOYMENT_STAGE` | `LIVE_SHADOW` |
| `BROKER_MODE` | `DISABLED` |
| `AI_ENABLED` | `false` |

V3 setup-tracking flags unchanged (`SETUP_TRACKING_ENVIRONMENTS=TEST,LIVE`).

## Isolation guarantees

- V4 runs only after V3 decision save + setup attempt.
- V4 errors are caught, logged, non-fatal; webhook response unchanged.
- V4 never mutates V3 decisions/setups/analytics and never calls broker code.
- Records use `strategyVersion=4`, `mode=SHADOW`, `environment=LIVE|TEST`.

## Historical data

- **Archive in repo:** none suitable for performance evidence.
- **Importer:** `backend/src/services/v4/historicalImporter.ts` + `backend/scripts/importV4HistoricalData.ts`
- **Docs:** `docs/V4_HISTORICAL_IMPORTER.md`
- Absence of history does **not** block LIVE shadow collection.

## COMEX GC provider

- Abstraction: `gcProvider.ts`
- Current state: `gcProfile=null` / **GC CONFIRMATION UNAVAILABLE**
- Quality penalty applied; analysis continues
- Data-source options documented (free delayed / broker chart / paid — no purchase without approval)

## Tests (local)

| Suite | Result |
| --- | --- |
| Backend lint | PASS |
| Backend typecheck/build | PASS |
| Backend tests | **126** passed |
| Web lint | PASS |
| Web typecheck | PASS |
| Web tests | **46** passed |
| Web production build | PASS |

Covered: V3 isolation, separate storage, non-actionable shadow, tiny-stop rejection, immutability, idempotent/OOO/stale bars, candidate expiry, SL-first ambiguous, GC unavailable, fail-closed flags, auth scoping, analytics separation.

## LIVE evidence (post-deploy)

Populate after deployment + real webhook traffic:

| Metric | Value |
| --- | --- |
| Genuine LIVE V4 analyses | _pending live traffic_ |
| Candidates created | _pending_ |
| Candidates rejected (by reason) | _pending_ |
| Validated shadow plans | _pending_ |
| Resolved shadow plans | _pending_ |
| Unsafe-plan count | **expected 0** |
| Plan-mutation count | **expected 0** |
| V3 regressions | **none expected** |

## Manual €20 testing

**Not recommended.** Gates not met:

- No real out-of-sample archive yet
- Net expectancy / profit factor not evidenced on LIVE shadows
- &lt; 50 resolved LIVE shadow plans
- Do not promote V4; do not enable broker; do not merge automatically

## Remaining blockers

1. Authorised COMEX GC feed (optional; currently honest UNAVAILABLE)
2. Real chronological XAUUSD archive import for OOS research
3. Accumulation of ≥50 resolved LIVE shadow plans before any manual forward discussion
4. Cloudflare Pages deploy of Stage B UI (if token available)
5. Confirm CI green on clean PR head
