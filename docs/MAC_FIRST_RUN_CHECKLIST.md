# Mac First Run Checklist

Follow these 20 steps on a Mac with Xcode. The source was prepared on Linux, so the iOS app is not build-verified until you run Xcode locally.

1. Install Xcode 15 or newer from the Mac App Store.
2. Open Xcode once and accept any license or component-install prompts.
3. Install the Firebase CLI if you will deploy from the Mac: `npm install -g firebase-tools`.
4. Clone or pull the latest `cursor/production-connection` branch.
5. Confirm `ios/GoldMeta/App/GoogleService-Info.plist` does not exist in Git history or staged changes.
6. In Firebase Console, create or select the GoldMeta Firebase project.
7. Enable Firebase Authentication and turn on the Email/Password provider.
8. Add an iOS app in Firebase with bundle ID `app.goldmeta.GoldMeta`.
9. Download the real `GoogleService-Info.plist` from Firebase Console.
10. Place the real plist at `ios/GoldMeta/App/GoogleService-Info.plist`.
11. Copy `ios/GoldMeta/Config/Secrets.xcconfig.example` to `ios/GoldMeta/Config/Secrets.xcconfig`.
12. Edit `Secrets.xcconfig` and set `GOLDMETA_API_BASE_URL` to your local emulator or deployed Cloud Functions `api` URL.
13. Set `GOLDMETA_USE_MOCK_AUTH = NO` when testing real Firebase sign-in.
14. Open `ios/GoldMeta.xcodeproj` in Xcode.
15. Wait for Swift Package Manager to resolve `https://github.com/firebase/firebase-ios-sdk`.
16. Select the GoldMeta app target and confirm the FirebaseAuth, FirebaseMessaging, and FirebaseCore products are linked.
17. Select a simulator or physical iPhone running iOS 17 or newer.
18. Run Product > Build and fix any Mac/Xcode-only signing or package-resolution issues.
19. Run the app, create or sign into an email/password account, and complete onboarding.
20. Run through `docs/END_TO_END_TEST.md` before trusting production alerts.
