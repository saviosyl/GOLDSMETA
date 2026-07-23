# Owner Auth UID protection

Pinned production owner email is `saviosyl@gmail.com`.
The required Auth UID is stored only as server secret `GOLDMETA_PINNED_OWNER_UID`
(Secret Manager / Functions secrets / ops env). Never put the full UID in web or iOS.

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

## Integrity monitor

Admin-only `GET /v1/admin/auth-integrity` and
`npm run verify:owner-auth` (script) are read-only. They never mutate Auth.

Statuses: HEALTHY | OWNER_UID_MISMATCH | OWNER_AUTH_MISSING | DUPLICATE_OWNER_EMAIL | CONFIGURATION_MISSING

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
