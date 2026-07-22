# Push Notifications

GoldMeta uses push notifications to notify the user when a new BUY, SELL, or WAIT decision is available.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## Goals

- Notify quickly after a validated decision is created.
- Keep sensitive analysis details inside the app when possible.
- Preserve an audit record of notification attempts.
- Avoid notification language that implies guaranteed profit.

## iOS setup

1. Enable **Push Notifications** capability in the Apple Developer portal.
2. Enable **Background Modes** with remote notifications.
3. Add Firebase Messaging to the iOS app through the Firebase iOS SDK package.
4. Add the real `GoogleService-Info.plist` locally; never commit it.
5. Request notification permission after onboarding explains what the alerts mean.
6. Register the FCM token with the backend for the authenticated user.
7. Refresh the backend token record whenever FCM rotates the token.
8. Unregister the backend device record on sign-out.

Implemented iOS source files:

- `ios/GoldMeta/App/GoldMetaAppDelegate.swift`
- `ios/GoldMeta/Services/PushNotificationService.swift`
- `ios/GoldMeta/Services/APIClient.swift`
- `ios/GoldMeta/Services/NotificationRouter.swift`

## Backend device model

Suggested fields for `users/{userId}/devices/{deviceId}`:

```json
{
  "deviceId": "ios-device-or-install-id",
  "platform": "ios",
  "fcmToken": "<stored-server-side>",
  "appVersion": "1.0.0",
  "registeredAt": "2026-07-20T00:00:00Z"
}
```

Do not expose another user's device tokens. Remove tokens when users sign out or revoke notification permission.

## Notification content

Keep push content short:

```text
GoldMeta: WAIT on XAUUSD
New analysis is ready.
```

For BUY/SELL decisions:

```text
GoldMeta: BUY setup on XAUUSD
Open the app to review entry, risk, and invalidation.
```

Avoid:

- "Guaranteed"
- "Sure win"
- "Profit locked"
- "Cannot lose"
- Any wording that treats confidence as win probability

## Payload shape

Recommended FCM data payload:

```json
{
  "type": "decision.created",
  "decisionId": "decision_123",
  "symbol": "XAUUSD",
  "decision": "WAIT",
  "generatedAt": "2026-07-20T00:00:00Z"
}
```

The app should fetch the full decision from the backend after opening.

The current iOS source routes `decisionId` through `NotificationRouter` and opens the matching decision analysis sheet.

## Delivery rules

- Send only after final safety validation.
- Do not notify for duplicate raw TradingView events.
- Consider rate limits per user and per symbol.
- Send WAIT notifications only if the user enabled them or if WAIT is safety-critical.
- Store notification status in `notificationEvents`.

## Failure handling

| Failure | Action |
|---|---|
| Invalid FCM token | Mark device token invalid and stop sending to it. |
| Permission denied | Keep decisions in history; do not retry push until permission changes. |
| Transient FCM error | Retry with bounded backoff. |
| Duplicate decision | Do not send a second push. |

## User controls

The app should let users configure:

- BUY/SELL alerts
- WAIT alerts
- Quiet hours
- Minimum confidence label for notifications, if supported
- Push token reset or troubleshooting

The current Settings screen shows the last push registration status reported by `PushNotificationService`.

Confidence is a quality/completeness score. It is not a probability that a trade will win.
