# Deployment

This guide is for deploying the backend and preparing the iOS app for a real TestFlight or device run.

## Important limitation

This repository can be edited on Linux, but iOS builds require macOS and Xcode. Do not consider the iOS app build-verified until `xcodebuild` or Xcode Product > Build succeeds on a Mac.

## Backend deployment prerequisites

- Firebase project created.
- Billing enabled if required by Cloud Functions gen2.
- Firebase CLI authenticated.
- Firestore enabled.
- Firebase Authentication enabled.
- Firebase Cloud Messaging configured.
- Environment variables/secrets set outside Git.

## Local backend

```bash
cd backend
cp .env.example .env
npm install
npm test
npm run build
npm run dev
```

For local iOS testing, set:

```text
GOLDMETA_API_BASE_URL = http://127.0.0.1:8080
```

If you are running an iPhone device instead of a simulator, use the Mac's LAN IP address instead of `127.0.0.1`.

## Production backend configuration

Use Firebase/Google Cloud configuration, Secret Manager, or CI environment settings for:

- `APP_ENV=production`
- `NODE_ENV=production`
- `STORAGE_BACKEND=firestore`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_REGION`
- `WEBHOOK_PUBLIC_BASE_URL`
- `AI_ENABLED`
- `OPENAI_API_KEY` if AI is enabled

`WEBHOOK_PUBLIC_BASE_URL` must be the public URL prefix that TradingView can reach, without a trailing slash.

## Deploy commands

From the repository root or backend folder, use your Firebase project alias:

```bash
firebase use <project-alias>
firebase deploy --only functions,firestore:rules,firestore:indexes
```

If this repository does not yet contain final Firestore rules/indexes, deploy functions first in a non-production project and verify data access manually before production.

## iOS release preparation

On the Mac:

1. Add real `GoogleService-Info.plist` locally.
2. Add local `Secrets.xcconfig`.
3. Set `GOLDMETA_USE_MOCK_AUTH = NO`.
4. Set `GOLDMETA_API_BASE_URL` to the deployed `api` URL.
5. Resolve Firebase SPM packages.
6. Build in Xcode.
7. Run `docs/END_TO_END_TEST.md`.
8. Archive and upload to TestFlight only after successful local validation.

## Post-deploy checks

- Authenticated `GET /v1/system/status`.
- Create TradingView connection from iOS.
- Send backend test alert.
- Confirm TEST decision appears.
- Register push token.
- Confirm sign-out unregisters the device.
- Send a TradingView test payload to the generated URL.

## Rollback

1. Disable TradingView alerts.
2. Revoke or rotate compromised webhook connections.
3. Redeploy the previous Cloud Functions version.
4. Set `AI_ENABLED=false` if AI behavior or cost is the issue.
5. Ask the iOS user to sign out and sign in again to refresh tokens.
6. Record what changed and what validation was performed.

## Secret-scanning before release

Before pushing or tagging a release:

```bash
git status --short
git diff --cached
git diff --cached --name-only
```

Manually confirm the staged diff does not contain:

- `GoogleService-Info.plist`
- `Secrets.xcconfig`
- Firebase Admin JSON
- OpenAI keys
- APNs private keys
- FCM tokens
- Webhook payload secrets
