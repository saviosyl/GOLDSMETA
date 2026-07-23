# Owner Auth UID protection

Pinned production owner email is `saviosyl@gmail.com`.
The required Auth UID is stored only as server secret `GOLDMETA_PINNED_OWNER_UID`
(Secret Manager / Functions secrets / ops env). Never put the full UID in web or iOS.

## Critical rule — never delete and recreate by email

Deleting the Auth user and creating a new account with the same email produces a
**different random UID**. Firestore owner documents and TradingView webhooks stay
bound to the original pinned UID, so the product breaks even though sign-in appears
to work.

- Do **not** delete the pinned owner in Firebase Console
- Do **not** use Admin SDK `deleteUser` / `accounts:delete` / bulk-delete in
  verification, deploy, or CI
- Do **not** rotate the owner password during deployment verification
- Do **not** send repeated password-reset emails during automation

If Auth drift is detected, **stop** and use the break-glass restore path below.
Never “fix” by Console SignUp.

## Client registration

Public self-registration is disabled in:

- `web/src/pages/SignInPage.tsx`
- `web/src/lib/firebase.ts` (`signUp` throws; no `createUserWithEmailAndPassword`)
- iOS `FirebaseAuthService.signUp` / onboarding (create toggle removed)

Sign-in and password reset remain available.

## Server blocking

`beforeUserCreatedGuard` (Firebase Functions v2 Identity blocking) rejects all
client-side account creation unless email+UID exactly match the pinned owner
(controlled restore path). Requires Identity Platform Auth blocking functions.

Admin SDK / Identity Toolkit privileged imports do **not** trigger blocking
functions — keep public signup UI disabled before any restore.

## Integrity monitor (read-only)

Admin-only `GET /v1/admin/auth-integrity` and
`npm run verify:owner-auth` (script) are **read-only**. They must never:

- call `deleteUser` / createUser / updateUser
- rotate passwords
- send OOB / password-reset emails
- migrate Firestore

Statuses: HEALTHY | OWNER_UID_MISMATCH | OWNER_AUTH_MISSING | DUPLICATE_OWNER_EMAIL | CONFIGURATION_MISSING

## Break-glass restore (explicit approval only)

One-time Admin restore script:

`backend/scripts/restorePinnedOwnerAuth.ts`

Requires:

```bash
GOLDMETA_BREAK_GLASS_AUTH_RESTORE=YES_I_APPROVE_PINNED_OWNER_RESTORE
GOLDMETA_PINNED_OWNER_UID=<from Secret Manager only>
GOLDMETA_TEMP_PASSWORD_FILE=<operator-only local path>
```

Behaviour:

- deletes only the exact incorrect replacement UID resolved by owner email
- recreates the user with **explicit** `uid = pinned UID`
- never prints full UID or temporary password
- never touches Firestore, webhooks, or the pinned UID secret
- fail-closed; second run is a no-op when already healthy

Do not commit secrets or temporary passwords. Do not merge restore execution into
production deploy pipelines.

## Pinned owner deletion / mutation guard

The pinned owner UID must **never** be deleted, disabled, email-renamed,
anonymised, or included in bulk Auth cleanup unless **both** are set:

- `GOLDMETA_BREAK_GLASS_OWNER_AUTH_MUTATION=1`
- `GOLDMETA_BREAK_GLASS_OWNER_AUTH_CONFIRM=I_UNDERSTAND_PINNED_OWNER_MUTATION`

Use `assertPinnedOwnerMutationAllowed` from
`backend/src/services/auth/pinnedOwnerMutationGuard.ts` in any ops script before
Identity Toolkit `accounts:delete` / disable / email update / anonymise.

Forbidden ephemeral agent patterns (do not re-run):

- `POST .../accounts:delete` with `{ localId }` against production without the
  pinned-owner guard
- client `accounts:delete` with an owner `idToken` after temporary password sign-in
- email-loop cleanup that is not strictly filtered away from the owner email
- rename/delete “stray” flows that can target the pinned UID by mistake

Enable Cloud Audit Logs **Data Access** (`DATA_WRITE`) for
`identitytoolkit.googleapis.com` so future deletes are attributable.
