# Safe user registration and approval

## Scope

Public email/password registration with:

- protected owner email/UID isolation (`saviosyl@gmail.com` + `GOLDMETA_PINNED_OWNER_UID`)
- email verification required
- server-authoritative roles (`OWNER` / `ADMIN` / `USER_APPROVED` / `USER_PENDING` / `USER_SUSPENDED`)
- admin approval centre at `/admin/users`
- broker access **not** granted by registration

## Owner protection

Registration explicitly rejects the protected owner email with:

> This account already exists. Please use Sign In or Forgot Password.

`beforeUserCreatedGuard` still allows only pinned-UID restore for that email and never creates a replacement owner Auth user.

## Roles

Custom claim `role` is set by trusted backend paths only. Firestore profile role fields are not client-writable.

| Role | Access |
|------|--------|
| `USER_PENDING` | Verify email → awaiting approval; account/help only |
| `USER_APPROVED` | General analysis; broker locked unless `brokerAccess=true` |
| `ADMIN` | Approve/suspend users; cannot promote to OWNER |
| `OWNER` | Pinned UID only |

## Flags for new users

`brokerAccess=false`, `brokerExecution=false`, `autoTrade=false`, `liveTrading=false`, `demoOrderSubmission=false`

## Key routes

- `POST /v1/auth/register`
- `POST /v1/auth/register/preflight`
- `GET /v1/auth/me`
- `POST /v1/auth/resend-verification`
- `GET /v1/admin/users`
- `POST /v1/admin/users/:uid/{approve|reject|suspend|restore}`

## Web routes

`/register`, `/registration-complete`, `/verify-email`, `/awaiting-approval`, `/account-suspended`, `/password-reset-sent`, `/admin/users`
