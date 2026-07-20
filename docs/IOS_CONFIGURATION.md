# iOS Configuration

This document explains the iOS app configuration files and what the owner must do on a Mac.

## Files

| File | Purpose | Commit? |
|---|---|---|
| `ios/GoldMeta/Config/Debug.xcconfig` | Checked-in DEBUG defaults. | Yes |
| `ios/GoldMeta/Config/Release.xcconfig` | Checked-in RELEASE placeholders. | Yes |
| `ios/GoldMeta/Config/Secrets.xcconfig.example` | Template for local overrides. | Yes |
| `ios/GoldMeta/Config/Secrets.xcconfig` | Real local API URL/mock-auth settings. | No |
| `ios/GoldMeta/App/GoogleService-Info.plist.example` | Placeholder Firebase plist shape. | Yes |
| `ios/GoldMeta/App/GoogleService-Info.plist` | Real Firebase plist from Console. | No |

## API base URL

The app reads `GOLDMETA_API_BASE_URL` through `Info.plist` key `APIBaseURL`.

DEBUG default:

```text
http://127.0.0.1:8080
```

Release placeholder:

```text
https://YOUR_CLOUD_FUNCTIONS_URL
```

Use `Secrets.xcconfig` to override either value locally. Do not hardcode a production URL in Swift.

## Auth mode

The app reads `GOLDMETA_USE_MOCK_AUTH` through `Info.plist` key `UseMockAuth`.

- `YES`: use `MockAuthService` for local UI and DEBUG previews.
- `NO`: use `FirebaseAuthService` and Firebase email/password.

If `GoogleService-Info.plist` is missing, the app logs a clear message and DEBUG mock auth can still be used for local UI work.

## Firebase packages

The Xcode project references the official Firebase iOS SDK:

```text
https://github.com/firebase/firebase-ios-sdk
```

Products linked by the app target:

- FirebaseAuth
- FirebaseMessaging
- FirebaseCore

Let Xcode resolve packages on the Mac. This Linux environment did not run Xcode package resolution.

## Push notifications

The source includes:

- `GoldMetaAppDelegate` via `UIApplicationDelegateAdaptor`.
- APNs token forwarding to Firebase Messaging.
- FCM token refresh handling.
- Backend device registration with the authenticated API client.
- Remote notification background mode in `Info.plist`.
- Notification tap routing by `decisionId`.

On a real Apple Developer account, also enable:

1. Push Notifications capability.
2. Background Modes if Xcode does not pick up `remote-notification` automatically.
3. The correct APNs key/certificate in Firebase Console.

## DEBUG previews

Previews use `AppEnvironment.preview`, `MockAuthService`, and `MockDecisionService`. Keep mock fixtures intact so UI can be reviewed without Firebase, backend, or TradingView.

## Owner checklist

Use `docs/MAC_FIRST_RUN_CHECKLIST.md` for the first Mac run and `docs/END_TO_END_TEST.md` for validation.
