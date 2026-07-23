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
