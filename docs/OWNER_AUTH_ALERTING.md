# Owner Auth alerting (goldmeta-web)

Alerts must **not** include full Auth UIDs, passwords, tokens, or webhook IDs.

## Recommended log-based metrics

Project: `goldmeta-web`

### 1) Auth DeleteAccount

Filter:

```
protoPayload.serviceName="identitytoolkit.googleapis.com"
protoPayload.methodName="google.cloud.identitytoolkit.v1.AccountManagementService.DeleteAccount"
```

Alert when count > 0 in 5 minutes. Notify owner ops channel.

### 2) Owner-email SignUp (replacement risk)

Filter:

```
protoPayload.serviceName="identitytoolkit.googleapis.com"
protoPayload.methodName="google.cloud.identitytoolkit.v1.AuthenticationService.SignUp"
protoPayload.request.email="saviosyl@gmail.com"
```

Any hit outside an approved break-glass window is critical.

### 3) Scheduled integrity not HEALTHY

Use workflow `.github/workflows/owner-auth-integrity.yml` (cron) and fail the job when
status ≠ `HEALTHY`. Wire GitHub Actions failure notifications to the ops channel.

Optional: export script stdout `STATUS=` to Cloud Logging via a small scheduler job
and alert on `STATUS!=HEALTHY` (still redacting UID fields).

## Enable Data Access audit logs

Ensure Identity Toolkit **DATA_WRITE** / Admin Read audit logs remain enabled so
DeleteAccount / SignUp remain attributable (principal + user-agent).

## Notification text template

```
GoldMeta Auth alert: <metric>
Project: goldmeta-web
Action: inspect integrity (read-only) — do not Console-delete owner email
Docs: docs/OWNER_AUTH_PROTECTION.md
```
