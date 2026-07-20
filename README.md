# GoldMeta

Personal XAUUSD trading assistant for iPhone.

GoldMeta receives structured TradingView alerts, evaluates setups with a **deterministic** decision engine, uses AI only to explain and review conflicts, and notifies you of BUY / SELL / WAIT decisions.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## Repository

```text
GoldMeta/
├── ios/          # SwiftUI app (iOS 17+)
├── backend/      # Firebase Cloud Functions (TypeScript)
├── pine/         # TradingView Pine Script bridge
├── shared/       # Shared JSON schemas
└── docs/         # Architecture and setup guides
```

## Quick start — iOS (Phase 1 mock mode)

1. Open `ios/GoldMeta.xcodeproj` in **Xcode 15+** on macOS.
2. Select the **GoldMeta** scheme and an iPhone simulator (iOS 17+).
3. Build and run (`⌘R`).
4. Complete onboarding (mock auth is available in DEBUG).
5. Dashboard loads mock BUY / SELL / WAIT fixtures. Use **Developer → Cycle Fixture** in Settings (DEBUG) to switch scenarios.

No Firebase or TradingView credentials are required for mock mode.

### Unit tests

```bash
# From Xcode: Product → Test
# Or:
xcodebuild test -scheme GoldMeta -destination 'platform=iOS Simulator,name=iPhone 16'
```

## Quick start — Backend

```bash
cd backend
cp .env.example .env   # fill placeholders; never commit secrets
npm install
npm test
npm run build
```

Local Functions emulator (optional):

```bash
npm run serve
```

See [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md).

## TradingView

1. Add `pine/GoldMetaBridge.pine` to your chart.
2. Create an alert that sends the generated JSON webhook payload.
3. Follow [docs/TRADINGVIEW_SETUP.md](docs/TRADINGVIEW_SETUP.md).

## Documentation

| Doc | Purpose |
|-----|---------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design |
| [DECISION_ENGINE.md](docs/DECISION_ENGINE.md) | Scoring, guards, confidence |
| [TRADINGVIEW_SETUP.md](docs/TRADINGVIEW_SETUP.md) | Pine + alerts |
| [FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md) | Auth, Firestore, Functions |
| [PUSH_NOTIFICATIONS.md](docs/PUSH_NOTIFICATIONS.md) | FCM |
| [SECURITY.md](docs/SECURITY.md) | Webhook + secrets |
| [TESTFLIGHT_SETUP.md](docs/TESTFLIGHT_SETUP.md) | Distribution |
| [USER_GUIDE.md](docs/USER_GUIDE.md) | End-user guide |

## MVP status

Core MVP paths are implemented as source in this tree:

- Offline SwiftUI app with mock decisions and tests
- Backend webhook → snapshot → decision engine with tests
- AI explanation with fallback when OpenAI is unavailable
- Push notification service (requires Firebase credentials to send)
- Pine bridge + setup docs
- Journal API + basic iOS journal UI

**Requires your credentials for live operation:** Firebase project, OpenAI API key, Apple push capability, TradingView alert URL.

## License / ownership

User owns their trading data. Export and delete flows are provided. No advertising SDK. No sale of user data.
