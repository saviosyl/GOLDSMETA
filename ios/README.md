# GoldMeta iOS

Native SwiftUI Phase 1+ prototype for GoldMeta, an iPhone-first XAUUSD trading decision-support app.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## Requirements

- macOS with Xcode 15 or newer
- iOS 17+ simulator or device
- No Firebase credentials are required for DEBUG mock mode

## Open and run

1. Open `GoldMeta.xcodeproj` in Xcode.
2. Select the `GoldMeta` scheme.
3. Choose an iPhone simulator running iOS 17+.
4. Build and run with `Command-R`.
5. Complete onboarding. DEBUG builds include mock sign-in and ten bundled decision fixtures.

## Test

From Xcode, choose **Product > Test**.

Command line on macOS:

```bash
cd /workspace/GoldMeta/ios
xcodebuild test -scheme GoldMeta -destination 'platform=iOS Simulator,name=iPhone 16'
```

## Mock fixtures

Fixtures live in `GoldMeta/Resources/MockFixtures` and cover:

- strong BUY
- weak BUY downgraded to WAIT by risk/reward
- strong SELL
- conflicted WAIT
- stale WAIT
- missing confirmation
- provisional setup
- active trade after TP1
- invalidation
- offline recovery

Use **Settings > Developer > Cycle mock fixture** in DEBUG builds to rotate the dashboard state.

## Architecture

- SwiftUI + MVVM
- `AppEnvironment` injects services and local persistence
- `DecisionServiceProtocol` supports live API and mock implementations
- User defaults + Codable are used for Phase 1 local persistence
- Keychain wrapper is included for future tokens; no secrets are committed

## Notes

This project is authored in a Linux cloud workspace, so final compilation and simulator testing require macOS/Xcode.
