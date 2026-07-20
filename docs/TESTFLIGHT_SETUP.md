# TestFlight Setup

Use TestFlight to distribute GoldMeta builds before App Store release.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## Prerequisites

- Apple Developer Program membership.
- App Store Connect access.
- Bundle identifier for the app.
- Push notification capability configured if testing notifications.
- Firebase project configured for the same bundle identifier.
- Privacy policy and terms URLs ready for external testing.

## App identifiers

Use separate bundle identifiers when possible:

```text
com.<your-org>.GoldMeta.dev
com.<your-org>.GoldMeta.staging
com.<your-org>.GoldMeta
```

Each environment should point to its own Firebase configuration and backend.

## Xcode archive

1. Open the iOS project in Xcode.
2. Select the release scheme.
3. Select **Any iOS Device** as the run destination.
4. Confirm signing team and bundle identifier.
5. Increment build number.
6. Choose **Product > Archive**.
7. In Organizer, validate the archive.
8. Distribute to App Store Connect.

Do not include backend secrets or private keys in the app bundle.

## App Store Connect

1. Create the app record.
2. Upload the build from Xcode or Transporter.
3. Wait for processing.
4. Add internal testers.
5. Complete export compliance questions.
6. Add test information and review notes for external testing.
7. Submit external testing build for Beta App Review, if needed.

## Beta review notes

Include plain instructions:

- GoldMeta is a market analysis and decision support app.
- It does not execute trades.
- Testers can use mock mode if live TradingView/Firebase setup is not available.
- If live mode is enabled, testers need their own TradingView alert webhook setup.

Do not include fake credentials. If a demo account is needed, create a real restricted test account and rotate it after review.

## Tester guidance

Ask testers to verify:

- Onboarding disclaimer appears.
- Notification permission flow is understandable.
- Mock BUY/SELL/WAIT states display correctly.
- Live decisions show generated time and market data time.
- WAIT appears when data is incomplete or stale.
- Journal entries can be added and deleted.
- Settings include data export/delete controls if implemented.

## Push notification testing

1. Install the TestFlight build.
2. Sign in.
3. Allow notifications.
4. Confirm the FCM token is registered in the backend.
5. Send a safe test decision or TradingView test payload.
6. Confirm notification opens the correct decision screen.

## Release checklist

- App uses production Firebase only for production builds.
- Debug mock controls are hidden or clearly marked.
- Privacy policy and terms links work.
- Disclaimer appears in onboarding and settings.
- No guaranteed-profit wording appears in UI, notifications, or screenshots.
- Confidence is described as quality/completeness, not win probability.
- Crash logging, if used, does not capture secrets or full webhook URLs.

## Versioning

Track:

- iOS app version/build.
- Backend version.
- Rule configuration version.
- Pine script version.
- AI prompt version, if enabled.

This makes support and audit trails much easier when testers report differences between decisions.
