# Firebase Setup

GoldMeta uses Firebase for authentication, Firestore, Cloud Functions, and push notification delivery.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## Services to enable

Enable these Firebase and Google Cloud services in your own project:

- Firebase Authentication
- Cloud Firestore
- Cloud Functions for Firebase
- Firebase Cloud Messaging
- Cloud Tasks or an equivalent async worker path, if used by the backend
- Secret Manager
- Cloud Logging

Use a real project you control. Do not commit project credentials or service account keys.

## Suggested environments

Create separate Firebase projects for:

- `goldmeta-dev`
- `goldmeta-staging`
- `goldmeta-prod`

Use separate webhook IDs, secrets, Firestore data, and Apple app identifiers for each environment.

## Authentication

Recommended MVP providers:

1. Sign in with Apple for production iOS.
2. Email link or email/password only if it matches your release plan.
3. DEBUG-only mock authentication for local development.

Backend user APIs should require Firebase ID tokens. Webhook endpoints should not require a user token because TradingView cannot send one; protect them with opaque webhook IDs, replay controls, schema validation, and rate limits.

## Firestore layout

Expected high-level structure:

```text
users/{userId}
  devices/{deviceId}
  settings/{settingsDoc}
  webhookConnections/{connectionId}
  rawEvents/{eventId}
  marketSnapshots/{snapshotId}
  decisions/{decisionId}
  journalEntries/{entryId}
  notificationEvents/{notificationId}
  auditEvents/{auditId}
system/configurations/{version}
system/health/{service}
```

Store raw TradingView payloads for auditability, but redact or avoid storing payload-level secrets.

## Cloud Functions configuration

Required configuration should be stored in Secret Manager or environment configuration, not in source control.

Typical values:

| Name | Purpose |
|---|---|
| `OPENAI_API_KEY` | Server-side AI explanation only, if enabled. |
| `WEBHOOK_SIGNING_SECRET` | Optional payload/HMAC validation if implemented. |
| `APP_ENV` | `dev`, `staging`, or `prod`. |
| `ALLOWED_ORIGINS` | HTTPS origins for user-facing APIs. |
| `DECISION_CONFIG_VERSION` | Active deterministic rule configuration. |

Never place these values in the iOS app bundle or Pine Script.

## Deployment checklist

1. Install Firebase CLI locally or in CI.
2. Authenticate with an account that has least-privilege deploy access.
3. Select the correct project.
4. Deploy Firestore rules and indexes.
5. Deploy functions.
6. Verify health endpoints.
7. Send a TradingView test payload.
8. Confirm the raw event, snapshot, decision, and notification audit records are created.

Example commands, adjusted for your project:

```bash
firebase use <project-alias>
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
```

Do not paste secrets into shell history on shared machines.

## Firestore security rules

Rules should enforce:

- Users can read and write only their own profile, settings, devices, journal entries, and decisions.
- Users cannot write raw market events or final decisions directly.
- Backend service accounts can write raw events, snapshots, decisions, and audit events.
- System configuration is read-only to clients unless explicitly needed.

## Data retention

Recommended defaults:

- Raw webhook events: retain long enough for troubleshooting and audit, then expire or archive.
- Decisions and journal entries: retain until the user deletes them.
- Notification audit events: retain for operational debugging.
- Logs: redact secrets and use limited retention in production.

## Local testing

Use Firebase emulators where possible:

```bash
firebase emulators:start
```

Use sample payloads from `pine/alert-payload-example.json`. Validate against `shared/schemas/tradingview-webhook-payload.schema.json`.

Confidence in GoldMeta is a measure of setup quality and input completeness. It is not a win probability or guarantee of outcome.
