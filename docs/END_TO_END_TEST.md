# End-to-End Test

Run this after the backend is deployed or the local emulator is running, and after the iOS app is configured on a Mac.

## Before you start

- Do not use real trading size because GoldMeta does not execute trades and is decision support only.
- Confirm the app's Settings screen shows the expected API mode.
- Confirm you can sign in with Firebase email/password.
- Confirm `GoogleService-Info.plist` and `Secrets.xcconfig` are local only and not staged in Git.

## Test 1: authenticated API

1. Launch the app.
2. Sign in or create an account.
3. Open Settings.
4. Confirm **API mode** points at the intended backend.
5. Confirm **Account** says signed in.
6. Tap **Create backend connection**.
7. Confirm a webhook URL appears and starts with your backend URL.

Expected result: the backend returns `{ connection: ... }` and the app shows a connection ID.

## Test 2: backend test alert

1. In Settings or onboarding, tap **Send test alert**.
2. Wait for the accepted message.
3. Open Dashboard and refresh.
4. Open History and refresh.

Expected result: a TEST decision is created and the iOS badge shows TEST when `isTestDecision` or `environment == TEST`.

## Test 3: push registration

1. In onboarding or Settings, read the notification explanation.
2. Tap **Register for push notifications**.
3. Allow notifications in the iOS permission prompt.
4. Confirm Settings shows a registered push status.
5. Trigger a new decision.
6. Tap the notification.

Expected result: the app opens the matching decision analysis from the notification `decisionId`.

## Test 4: TradingView webhook

1. In the app, create or open a TradingView connection.
2. Copy the webhook URL.
3. Copy the payload secret.
4. In TradingView, paste the URL into the alert webhook URL field.
5. In the Pine script inputs, paste the payload secret.
6. Use the Pine-generated JSON alert message.
7. Trigger a test alert from TradingView.

Expected result: backend validates the payload, stores the raw event, enqueues processing, creates a decision, and the app can fetch it.

## Test 5: sign-out cleanup

1. Open Settings.
2. Tap **Sign out**.
3. Confirm the push registration status resets or reports sign-out cleanup.
4. Sign back in.
5. Register push again if desired.

Expected result: the app unregisters the stored backend device before signing out.

## If a step fails

| Symptom | Check |
|---|---|
| Sign-in fails | Firebase Auth Email/Password provider and real plist. |
| API says unauthorized | ID token not attached, wrong backend project, or stale Firebase config. |
| API says not configured/offline | `GOLDMETA_API_BASE_URL` is missing or still a placeholder. |
| Webhook returns 404 | Wrong webhook ID or revoked connection. |
| Webhook returns 401 | Payload secret mismatch. |
| Webhook returns stale timestamp | TradingView payload `sentAt` is too old. |
| Push does not register | APNs capability, Firebase Messaging setup, simulator/device limitations. |

Record the exact error text before changing multiple settings at once.
