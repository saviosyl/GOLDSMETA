# Safe user registration and automatic activation

## Scope

Public email/password registration with:

- protected owner email/UID isolation (`saviosyl@gmail.com` + `GOLDMETA_PINNED_OWNER_UID`)
- email verification required
- server-authoritative roles (`OWNER` / `ADMIN` / `USER_APPROVED` / `USER_PENDING` / `USER_SUSPENDED`)
- **automatic basic app activation after email verification** (open mode)
- admin centre at `/admin/users` for suspension / exceptional review
- broker access **not** granted by registration
- default mode: `OPEN` (`REGISTRATION_APPROVAL_REQUIRED=false`)

## Registration flags (env)

| Flag | Default |
|------|---------|
| `REGISTRATION_ENABLED` | `true` |
| `REGISTRATION_APPROVAL_REQUIRED` | `false` (set `true` to restore manual approval) |
| `REGISTRATION_INVITE_ONLY` | `false` (set `true` later without code change) |
| `APP_CHECK_ENFORCE` | `false` (optional App Check on register/reset) |

New accounts always receive `USER_PENDING` with broker/AutoTrade flags false until email verification. After verification in open mode they become `USER_APPROVED` for analysis only.

Status endpoint reports:

- `registrationEnabled=true`
- `emailVerificationRequired=true`
- `approvalRequired=false`
- `brokerEnabledByRegistration=false`
- `autoTradeDefault=OFF`

## Flow

1. User registers → `USER_PENDING`, verification email sent.
2. Unverified users receive `VERIFY_EMAIL` — Dashboard stays inaccessible.
3. After email verification, `/v1/auth/me` (and approved API gates) idempotently promote to `USER_APPROVED`.
4. User sees “Your account is ready” and can open the Dashboard.
5. Broker / OAuth / AutoTrade / Live remain locked (`brokerAccess=false`).

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

Automatic activation never modifies OWNER/ADMIN accounts or the pinned owner UID.

## Existing pending users

`GET /v1/admin/users/pending-activation-report` returns a dry-run count of verified `USER_PENDING` accounts eligible for one-time backfill. It does **not** migrate. Do not run a migration without separate owner approval.

## Roles

| Role | Access |
|------|--------|
| `USER_PENDING` | Verify email required; awaiting activation or exceptional review |
| `USER_APPROVED` | General analysis; broker locked unless `brokerAccess=true` |
| `ADMIN` | Approve/suspend users; cannot promote to OWNER |
| `OWNER` | Pinned UID only |

## Flags for new users

`brokerAccess=false`, `brokerExecution=false`, `autoTrade=false`, `liveTrading=false`, `demoOrderSubmission=false`

## Key routes

- `POST /v1/auth/register`
- `POST /v1/auth/register/preflight`
- `POST /v1/auth/password-reset`
- `GET /v1/auth/me` (auto-activates when eligible)
- `POST /v1/auth/resend-verification`
- `GET /v1/admin/users`
- `GET /v1/admin/users/pending-activation-report`
- `GET /v1/admin/users/audit`
- `POST /v1/admin/users/:uid/{approve|reject|suspend|restore}`
