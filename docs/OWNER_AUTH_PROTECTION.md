# Owner Auth UID protection

Pinned production owner email is `saviosyl@gmail.com`.
The required Auth UID is stored only as server secret `GOLDMETA_PINNED_OWNER_UID`
(Secret Manager / Functions secrets / ops env). Never put the full UID in web or iOS.

## Critical operational warning

**Never delete `saviosyl@gmail.com` in Firebase Console.**

Recreating the same email creates a **different random UID** and disconnects existing
GoldMeta Firestore data and TradingView webhooks that remain bound to the pinned UID.

Public registration is available via `/register` and `POST /v1/auth/register`
(see `docs/USER_REGISTRATION.md`). The protected owner email is always rejected
with an account-exists message and never creates a replacement UID.

Sign-in and password reset remain available. Password reset for the owner email
targets the existing pinned UID only (Firebase Auth); registration never falls
back for that email.

Also never:

- use Admin SDK `deleteUser` / Identity Toolkit `DeleteAccount` against the pinned UID
- use owner email for test registration or cleanup loops
- rotate the owner password automatically during deploy verification
- “fix” Auth drift with Console SignUp
- invoke `restorePinnedOwnerAuth.ts` from CI/CD or normal deployments

If Auth integrity is not `HEALTHY`, **stop** and use the break-glass restore path below.
Do **not** auto-restore from deploy pipelines.

## Identity blocking / registration

`beforeUserCreatedGuard` (Firebase Functions v2 Identity blocking):

- allows pinned owner UID restore only for the owner email
- rejects any other UID for the owner email (`OWNER_EXISTS` message)
- allows non-owner emails when `PUBLIC_REGISTRATION_ENABLED` is not `false`

Admin SDK registration does **not** trigger blocking functions and is the
preferred server path for validated, rate-limited signup.

## Root-cause note (2026-07-24)

Cloud Audit Logs show the pinned owner was deleted via **Firebase Console**
(browser Chrome user-agent) by principal `saviosyl@gmail.com`, then a replacement
account was created with Console SignUp for the same email. Classification:
`MANUAL_CONSOLE`. This is not a CI/Cloud Function/test-cleanup path.

## IAM / Console least privilege (recommended)

| Identity | Guidance |
|----------|----------|
| `user:saviosyl@gmail.com` (`roles/owner`) | Keep break-glass ownership, but do **not** use everyday Console sessions to delete Auth users. Prefer a separate bookmark-free workflow and treat Auth Users delete as high risk. |
| `firebase-adminsdk-…` (`roles/firebaseauth.admin`) | Required for Admin SDK deploy/runtime. Must **not** run opportunistic user deletion. |
| Compute / App Engine default SAs (`roles/editor`) | Prefer narrowing away from Auth user-admin where operationally possible; do not grant extra Auth delete roles. |
| Dedicated break-glass SA (recommended) | Create a separate SA used only for explicit restore scripts; keep key offline. |

Do **not** lock the owner out of the project. Do remove unnecessary human editors with Auth admin.

## Alerting (documented — enable in Cloud Monitoring)

Create log-based metrics / alerts that **never** include full UIDs in notification text:

1. **DeleteAccount** on `identitytoolkit.googleapis.com`
2. **SignUp** where email equals owner email (replacement risk)
3. Scheduled integrity job not `HEALTHY` (pinned missing / email mismatch)
4. Owner email mapping changed (integrity status `OWNER_UID_MISMATCH`)

See `docs/OWNER_AUTH_ALERTING.md`.

## Integrity monitor (read-only)

- Admin-only `GET /v1/admin/auth-integrity`
- `npm run verify:owner-auth` (`backend/scripts/verifyOwnerAuthIntegrity.ts`)
- `npm run gate:owner-auth-deploy` (`backend/scripts/preDeployOwnerAuthHealthGate.ts`) — **stop deploy** on failure
- GitHub workflow `.github/workflows/owner-auth-integrity.yml` (manual + scheduled)
- Optional live gate job in Backend workflow (skipped without secrets; required unit CI always runs)

Webhook ownership in the deploy gate:

- Requires at least one **ACTIVE** webhook owned by `GOLDMETA_PINNED_OWNER_UID`
- Prefers a canonical webhook id from the owner profile when present
- **Ignores** REVOKED historical webhooks (including legacy `…wbuu`)
- Does **not** use display-suffix matching
- Redacts webhook ids in logs (`maskWebhookId`)
- Never creates, deletes, revokes, or reassigns webhooks

The monitor must **never** repair, delete, or recreate users automatically.

Statuses: `HEALTHY` | `OWNER_UID_MISMATCH` | `OWNER_AUTH_MISSING` | `DUPLICATE_OWNER_EMAIL` | `CONFIGURATION_MISSING`

## Application / script protections

- `assertPinnedOwnerMutationAllowed` (`pinnedOwnerMutationGuard.ts`) before any delete/disable/email-rename/anonymise/bulk cleanup
- `ownerCleanupGuard.ts` excludes pinned UID, owner email, `OWNER` role, and `owner=true` claim from disposable cleanup
- Requires both for break-glass mutation:
  - `GOLDMETA_BREAK_GLASS_OWNER_AUTH_MUTATION=1`
  - `GOLDMETA_BREAK_GLASS_OWNER_AUTH_CONFIRM=I_UNDERSTAND_PINNED_OWNER_MUTATION`
- Registration and verification scripts must refuse owner-email cleanup and fail closed if pinned UID is missing
- Never auto-promote or recreate owner by email alone
- Normal deployments must never invoke `restorePinnedOwnerAuth.ts`

## Break-glass restore (explicit approval only)

Script: `backend/scripts/restorePinnedOwnerAuth.ts`

```bash
GOLDMETA_BREAK_GLASS_AUTH_RESTORE=YES_I_APPROVE_PINNED_OWNER_RESTORE \
GOLDMETA_PINNED_OWNER_UID="$(gcloud secrets versions access latest --secret=GOLDMETA_PINNED_OWNER_UID --project=goldmeta-web)" \
GOLDMETA_OWNER_EMAIL=saviosyl@gmail.com \
GOLDMETA_TEMP_PASSWORD_FILE=/secure/operator-only/path \
  npx tsx scripts/restorePinnedOwnerAuth.ts
```

Behaviour:

- deletes **only** the incorrect replacement UID returned by owner-email lookup
- recreates Auth user with **explicit** `uid = pinned UID`
- sets `emailVerified=true`, `disabled=false`, `role=OWNER` claims
- broker execution / AutoTrade / Live remain false
- never prints full UID or temporary password
- never touches Firestore ownership, webhooks, or the pinned UID secret
- second run is a no-op when already healthy

Pre-check (read-only): `backend/scripts/preRestoreOwnerAuthCheck.ts`

## Password reset

- Web Forgot Password uses Firebase client `sendPasswordResetEmail` (delivers mail).
- API `POST /v1/auth/password-reset` uses Identity Toolkit `sendOobCode` (not Admin
  `generatePasswordResetLink`, which does not send email).
- Owner password reset keeps the exact pinned UID, claims, Firestore profile, and webhook.
- Never print reset links or temporary passwords in logs/reports.

## Client registration note

Public registration must always reject the protected owner email before `createUser`
and must never be used to restore the owner.
