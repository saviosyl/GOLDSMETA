# Production Connection

This guide connects the iOS app, Firebase Auth, Cloud Functions backend, Firestore, FCM push notifications, and TradingView webhooks.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## What "production connection" means

A working production connection has all of these pieces:

- A Firebase project you control.
- Email/password Firebase Authentication enabled.
- Firestore storage selected for the backend.
- Cloud Functions deployed with the HTTPS `api` function.
- A public base URL configured for webhook links.
- A real `GoogleService-Info.plist` on the Mac only.
- iOS `Secrets.xcconfig` pointing at the backend URL.
- A signed-in iOS user who creates a TradingView connection.
- TradingView alerts posting the backend-generated webhook URL and payload secret.

## Backend environment

Use `backend/.env.example` as the template. Important values:

| Variable | Value |
|---|---|
| `APP_ENV` | `production` for real deployment. |
| `STORAGE_BACKEND` | `firestore` for production. |
| `FIREBASE_PROJECT_ID` | Your Firebase project ID. |
| `FIREBASE_REGION` | Region used by Cloud Functions, for example `us-central1`. |
| `WEBHOOK_PUBLIC_BASE_URL` | Public HTTPS base URL for the deployed `api` function. |
| `AI_ENABLED` | `false` until OpenAI billing/secrets are intentionally configured. |
| `OPENAI_API_KEY` | Backend-only secret if AI explanations are enabled. |

Never put Firebase Admin keys, OpenAI keys, Apple private keys, or real `GoogleService-Info.plist` contents in Git.

## iOS configuration

1. Copy `ios/GoldMeta/Config/Secrets.xcconfig.example` to `ios/GoldMeta/Config/Secrets.xcconfig`.
2. Set `GOLDMETA_API_BASE_URL` to the deployed Cloud Functions `api` URL.
3. Set `GOLDMETA_USE_MOCK_AUTH = NO`.
4. Place the real Firebase plist at `ios/GoldMeta/App/GoogleService-Info.plist`.
5. Open `ios/GoldMeta.xcodeproj` and let Xcode resolve Firebase SPM packages.

DEBUG source defaults to `http://127.0.0.1:8080` and mock auth for local UI. Release source uses a placeholder Cloud Functions URL and requires a local secret override.

## TradingView connection flow

1. Sign into the iOS app with Firebase email/password.
2. In onboarding or Settings, tap **Create backend connection**.
3. Copy the webhook URL into TradingView's alert webhook URL field.
4. Copy the payload secret into the Pine Script input named payload secret.
5. Copy the example JSON only for manual sanity checks; the Pine script should generate the real payload.
6. Tap **Send test alert** in the app.
7. Confirm a TEST decision appears in Dashboard or History.

The backend stores webhook connections per Firebase user. Webhook requests do not use Firebase Auth because TradingView cannot attach user ID tokens; they use an opaque webhook ID, payload secret, timestamp checks, schema validation, dedupe, and rate limiting.

## Push notification flow

1. The app explains push notifications during onboarding.
2. The user grants notification permission.
3. APNs returns a device token.
4. Firebase Messaging returns an FCM token.
5. The app registers `{ deviceId, platform, fcmToken, appVersion }` with the backend using `Authorization: Bearer <Firebase ID token>`.
6. The backend sends FCM data payloads containing `decisionId`.
7. Notification taps route that `decisionId` into the app and open the decision analysis.
8. Sign-out unregisters the stored device.

## Smoke test order

Use this order after deployment:

1. `GET /health` or equivalent health endpoint.
2. iOS sign-in with email/password.
3. `GET /v1/system/status` from an authenticated client.
4. Create TradingView connection from iOS.
5. Send app test alert.
6. Confirm Firestore raw event, job, decision, and notification records.
7. Confirm push tap opens the matching decision ID.

## Rollback

If something looks wrong:

- Disable TradingView alerts first.
- Revoke or rotate the affected webhook connection.
- Set `AI_ENABLED=false` if AI output or costs are suspicious.
- Deploy the last known-good backend.
- Ask the user to sign out and sign in again to refresh ID tokens.
