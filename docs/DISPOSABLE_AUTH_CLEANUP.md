# Disposable Auth cleanup plan

## Problem

Preview/deploy agents may leave unverified disposable Auth users after registration E2E attempts.

## Hard exclusions (never delete)

- Pinned owner UID (`GOLDMETA_PINNED_OWNER_UID`)
- Owner email (`GOLDMETA_OWNER_EMAIL` / `saviosyl@gmail.com`)
- Any user with role OWNER / ADMIN
- Verified users unless explicitly confirmed disposable
- Firestore owner profile documents
- Webhook connection records

## Safe list (read-only)

```bash
cd backend
npx tsx scripts/listDisposableAuthUsers.ts
```

Prints masked UIDs + email domains only.

## Approved cleanup options

1. **Firebase Console** — manually delete listed unverified disposable accounts.
2. **Short-lived cleanup identity** — temporary SA with Auth Admin, run a guarded delete script once, then disable the key.
3. **Do not** grant permanent Auth Admin to the deployment agent solely for cleanup.

## Pattern hints for disposables

- `gm.disposable.*@…`
- `@web-library.net` (temp inbox tests)
- Unverified + created during deploy windows

## After cleanup

Re-run owner health gate (`npm run gate:owner-auth-deploy`) and confirm webhook ownership unchanged.
