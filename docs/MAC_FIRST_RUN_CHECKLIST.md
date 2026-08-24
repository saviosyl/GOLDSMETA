# Mac First Run Checklist

Use this when you are back on your MacBook.  
**This environment prepared iOS source only — simulator/device builds were not verified here.**

Branch: `cursor/production-connection`  
Repo: https://github.com/saviosyl/GOLDSMETA

---

## 1. Pull the latest branch

```bash
git clone https://github.com/saviosyl/GOLDSMETA.git
cd GOLDSMETA
git fetch origin
git checkout cursor/production-connection
git pull origin cursor/production-connection
```

## 2. Open the Xcode project

```bash
open ios/GoldMeta.xcodeproj
```

Use **Xcode 15+**. Accept any first-launch license prompts.

## 3. Install or resolve Firebase Swift packages

1. In Xcode: **File → Packages → Resolve Package Versions**.
2. Confirm the package URL is `https://github.com/firebase/firebase-ios-sdk`.
3. Confirm these products are linked to the GoldMeta target:
   - `FirebaseCore`
   - `FirebaseAuth`
   - `FirebaseMessaging`
4. If packages are missing: **File → Add Package Dependencies…** and add that URL, then link the three products.

## 4. Add `GoogleService-Info.plist`

1. In Firebase Console → Project settings → Your apps → iOS app.
2. Download `GoogleService-Info.plist`.
3. Drag it into `ios/GoldMeta/App/` in Xcode.
4. Check **Copy items if needed** and add to the **GoldMeta** target.
5. Do **not** commit this file (it is gitignored).

Use `ios/GoldMeta/App/GoogleService-Info.plist.example` only as a field reference.

## 5. Select your Apple Developer Team

1. Select the **GoldMeta** target.
2. **Signing & Capabilities**.
3. Enable **Automatically manage signing**.
4. Choose your **Team**.

## 6. Set the final bundle identifier

1. Still under **Signing & Capabilities**.
2. Set **Bundle Identifier** (example: `app.goldmeta.GoldMeta` or your own unique ID).
3. The Firebase iOS app bundle ID must match this value exactly.

## 7. Enable Push Notifications

1. **Signing & Capabilities → + Capability**.
2. Add **Push Notifications**.

## 8. Enable required Background Modes

1. Add **Background Modes**.
2. Enable **Remote notifications**.

## 9. Configure the backend API URL

1. Copy:

```bash
cp ios/GoldMeta/Config/Secrets.xcconfig.example ios/GoldMeta/Config/Secrets.xcconfig
```

2. Edit `Secrets.xcconfig` and set:

```text
GOLDMETA_API_BASE_URL = https://YOUR-REGION-YOUR-PROJECT.cloudfunctions.net/api
```

For local backend emulator/dev server you may use:

```text
GOLDMETA_API_BASE_URL = http://127.0.0.1:8080
```

3. Confirm Debug/Release xcconfigs include Secrets (see `docs/IOS_CONFIGURATION.md`).
4. Do **not** commit `Secrets.xcconfig`.

## 10. Build in the iPhone simulator

1. Choose an **iPhone simulator (iOS 17+)**.
2. **Product → Build** (`⌘B`).
3. Fix any signing/package errors if they appear.
4. **Product → Run** (`⌘R`).

## 11. Run unit tests

1. **Product → Test** (`⌘U`).
2. Confirm GoldMetaTests pass (decision decoding, dashboard states, journal metrics, settings).

## 12. Connect your real iPhone

1. Plug in the iPhone with a cable (or pair wirelessly).
2. Trust the computer if prompted.
3. Select the physical device in the Xcode scheme destination list.

## 13. Build and install on the iPhone

1. **Product → Run**.
2. On the iPhone: trust the developer certificate if iOS asks (**Settings → General → VPN & Device Management**).

## 14. Sign in to GoldMeta

1. Complete onboarding.
2. Create an account or sign in with **email/password**.
3. Confirm you are authenticated (Settings should show signed-in state).

## 15. Register the FCM token

1. When prompted, allow notifications **after** reading the explanation screen.
2. Open **Settings** and confirm push registration status is successful.
3. If it failed, note the on-screen status and check Xcode console logs for Messaging errors.

## 16. Send a test alert

1. In onboarding/Settings, create a TradingView connection if needed (copy webhook URL for later live use).
2. Tap **Send test alert** / connection test (calls `POST /v1/tradingview/test`).
3. Wait a few seconds for durable job processing.

## 17. Confirm the push notification

1. Background the app or lock the phone.
2. Confirm a GoldMeta test notification arrives.
3. Notification should be clearly test-related / TEST labelled where applicable.

## 18. Tap the notification

1. Tap the notification.
2. GoldMeta should open via deep link routing.

## 19. Confirm the matching decision opens

1. Dashboard / analysis should show the **same decision** stored by the backend.
2. Confirm a visible **TEST** badge.
3. Confirm it is **not** labelled as live market data.

## 20. Report any remaining error with the exact log location

If anything fails, capture:

| Area | Where to look |
|------|----------------|
| iOS runtime | Xcode → **Report navigator** / Debug console |
| Device logs | **Window → Devices and Simulators → Open Console** |
| Backend Functions | Firebase Console → **Functions → Logs** |
| Firestore writes | Firebase Console → **Firestore** → `users/{uid}/decisions`, `processingJobs` |
| Auth failures | Firebase Console → **Authentication** + Functions logs (`UNAUTHENTICATED` / `INVALID_TOKEN`) |
| Push failures | Firebase Console → **Messaging** + APNs key config; iOS Settings push status |

Paste the **exact error text**, HTTP status, and the log location above when asking for help.

---

## Prerequisites you must complete before steps 14–19 work

See also:

- `docs/FIREBASE_SETUP.md`
- `docs/DEPLOYMENT.md`
- `docs/PUSH_NOTIFICATIONS.md`
- `docs/END_TO_END_TEST.md`
- `docs/PRODUCTION_CONNECTION.md`

Minimum cloud setup:

1. Firebase project with Auth (Email/Password), Firestore, Functions, Messaging.
2. Backend deployed with `APP_ENV=production`, `STORAGE_BACKEND=firestore`.
3. APNs key uploaded to Firebase Cloud Messaging.
4. iOS API URL pointing at the deployed `api` function.
