# Firestore Data Model

GoldMeta stores user data under Firebase Auth user IDs and stores backend-owned processing records separately when needed.

## Ownership rule

Every user-facing record must include `userId`. The iOS app should only read/write data for the signed-in Firebase user through authenticated backend APIs.

## Top-level collections

```text
users/{userId}
  devices/{deviceId}
  settings/main
  journalEntries/{journalId}

webhookConnections/{webhookId}
rawEvents/{userId_eventId}
marketSnapshots/{userId_snapshotId}
decisions/{decisionId}
processingJobs/{jobId}
notificationEvents/{userId_key}
system/configurations/{version}
system/health/{service}
```

Firestore implementations may physically store some records under user subcollections, but the logical fields below should remain stable.

## `webhookConnections/{webhookId}`

Created from the authenticated iOS app.

```json
{
  "webhookId": "opaque-random-id",
  "userId": "firebase-uid",
  "secret": "payload-secret-or-null",
  "status": "ACTIVE",
  "createdAt": "2026-07-20T00:00:00.000Z",
  "updatedAt": "2026-07-20T00:00:00.000Z",
  "revokedAt": null,
  "rotatedAt": null,
  "lastAlertAt": null
}
```

Do not expose `secret` in unauthenticated reads. The iOS app receives it when a connection is created or rotated so the owner can copy it into TradingView.

## `rawEvents`

Created when TradingView posts to `/webhooks/tradingview/{webhookId}`.

```json
{
  "eventId": "stable-event-id",
  "userId": "firebase-uid",
  "webhookId": "opaque-random-id",
  "receivedAt": "2026-07-20T00:00:00.000Z",
  "payload": {},
  "environment": "LIVE",
  "isTestEvent": false,
  "createdAt": "2026-07-20T00:00:00.000Z",
  "updatedAt": "2026-07-20T00:00:00.000Z"
}
```

Raw payloads are useful for audit and debugging. Avoid logging or exporting payload secrets unnecessarily.

## `processingJobs/{jobId}`

Created after a raw event is accepted.

```json
{
  "jobId": "uuid",
  "userId": "firebase-uid",
  "eventId": "stable-event-id",
  "webhookId": "opaque-random-id",
  "state": "QUEUED",
  "retryCount": 0,
  "maxRetries": 3,
  "environment": "LIVE",
  "isTestDecision": false,
  "decisionId": null,
  "createdAt": "2026-07-20T00:00:00.000Z",
  "updatedAt": "2026-07-20T00:00:00.000Z"
}
```

Cloud Functions can process this document inline during tests or by Firestore trigger in production.

## `decisions/{decisionId}`

Created by the deterministic decision pipeline.

Important fields:

- `userId`
- `decisionId`
- `symbol`
- `decision`
- `confidence`
- `dataQuality`
- `dataSourceLabel`
- `entry`
- `stopLoss`
- `takeProfits`
- `riskReward`
- `reasonSummary`
- `warnings`
- `environment`
- `isTestDecision`
- `notificationSent`

The iOS app displays TEST when `isTestDecision == true` or `environment == "TEST"`.

## `users/{userId}/devices/{deviceId}`

Registered by iOS after APNs and FCM token setup.

```json
{
  "deviceId": "ios-device-id",
  "userId": "firebase-uid",
  "platform": "ios",
  "fcmToken": "fcm-token",
  "appVersion": "1.0",
  "registeredAt": "2026-07-20T00:00:00.000Z"
}
```

Delete this record on sign-out or when the token is revoked.

## `users/{userId}/settings/main`

Backend settings currently include:

```json
{
  "userId": "firebase-uid",
  "aiEnabled": false,
  "notificationsEnabled": true,
  "provisionalSignalsEnabled": true,
  "riskProfile": "CONSERVATIVE",
  "updatedAt": "2026-07-20T00:00:00.000Z"
}
```

iOS still keeps local UI settings such as paper mode and selected mock fixture in `UserDefaults`.

## Security rules summary

- Users can access only their own settings, devices, journal entries, and decisions.
- Clients cannot write raw events, snapshots, final decisions, or processing jobs directly.
- Backend service accounts write pipeline records.
- Logs and support exports should redact webhook secrets and FCM tokens.
