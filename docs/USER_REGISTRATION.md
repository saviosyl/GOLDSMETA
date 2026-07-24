# Safe user registration and approval

## Scope

Public email/password registration with:

- protected owner email/UID isolation (`saviosyl@gmail.com` + `GOLDMETA_PINNED_OWNER_UID`)
- email verification required
- server-authoritative roles (`OWNER` / `ADMIN` / `USER_APPROVED` / `USER_PENDING` / `USER_SUSPENDED`)
- admin approval centre at `/admin/users`
- broker access **not** granted by registration
- mode: `APPROVAL_REQUIRED` (`REGISTRATION_APPROVAL_REQUIRED=true`)

## Registration flags (env)

| Flag | Default |
|------|---------|
| `REGISTRATION_ENABLED` | `true` |
| `REGISTRATION_APPROVAL_REQUIRED` | `true` |
| `REGISTRATION_INVITE_ONLY` | `false` (set `true` later without code change) |
| `APP_CHECK_ENFORCE` | `false` (optional App Check on register/reset) |

New accounts always receive `USER_PENDING` with broker/AutoTrade flags false.

## Abuse protection

Firestore-backed rate limits (`rateLimits/*`) with in-memory fallback:

- 3 registration attempts / IP / hour
- 3 registration attempts / email / hour
- 20 registration attempts / minute (global)
- 3 verification resends / account / day
- 5 password-reset requests / email / day
- admin-action rate limit / actor / hour

Also: strict `application/json` for register/reset, 128kb body limit, normalized lowercase email, redacted audit events.

## Owner protection

Registration explicitly rejects the protected owner email **before** `createUser` with:

> This account already exists. Please use Sign In or Forgot Password.

`beforeUserCreatedGuard` still allows only pinned-UID restore for that email and never creates a replacement owner Auth user.

## Partial failure

Sequence: validate → rate-limit → reserve idempotency → Auth create → claims → profile → verification.

- Duplicate reservations do not create a second Auth user.
- Profile failure after Auth create marks `REGISTRATION_INCOMPLETE` — Auth user is **not** silently deleted.
- Accounts without a trusted role claim default fail-closed; legacy users with **no registration profile** retain analysis access only.
- Recovery never auto-promotes.

## Roles

Custom claim `role` is set by trusted backend paths only. Firestore profile role fields are not client-writable.

| Role | Access |
|------|--------|
| `USER_PENDING` | Verify email → awaiting approval; account/help only |
| `USER_APPROVED` | General analysis; broker locked unless `brokerAccess=true` |
| `ADMIN` | Approve/suspend users; cannot promote to OWNER; cannot act on peer ADMIN or self |
| `OWNER` | Pinned UID only |

## Flags for new users

`brokerAccess=false`, `brokerExecution=false`, `autoTrade=false`, `liveTrading=false`, `demoOrderSubmission=false`

## Key routes

- `POST /v1/auth/register`
- `POST /v1/auth/register/preflight`
- `POST /v1/auth/password-reset`
- `GET /v1/auth/me`
- `POST /v1/auth/resend-verification`
- `GET /v1/admin/users`
- `GET /v1/admin/users/audit`
- `POST /v1/admin/users/:uid/{approve|reject|suspend|restore}`

## Web routes

`/register`, `/registration-complete`, `/verify-email`, `/awaiting-approval`, `/account-suspended`, `/password-reset-sent`, `/admin/users`, `/legal/terms`, `/legal/privacy`, `/legal/risk`, `/account/delete-request`

## Deploy gate

Do **not** deploy registration while production Auth integrity is not `HEALTHY` (pinned owner UID present, email maps only to pinned UID, `emailVerified=true`).
