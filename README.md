# GoldMeta

Personal XAUUSD trading assistant.

GoldMeta receives structured TradingView alerts, evaluates setups with a **deterministic** backend decision engine, uses AI only to explain and review conflicts, and notifies you of BUY / SELL / WAIT decisions.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## Repository

```text
GoldMeta/
├── backend/      # Shared Firebase Cloud Functions API + decision engine
├── web/          # Primary browser / Progressive Web App (Home Screen)
├── ios/          # Native iOS backup / future App Store version
├── pine/         # TradingView Pine Script bridge
├── shared/       # Shared JSON schemas
└── docs/         # Architecture and setup guides
```

- **`web/`** is the main production client for Safari / desktop and iPhone Home Screen install (no Apple Developer Program required for initial use).
- **`ios/`** remains intact as the future App Store build and must not be deleted.
- **`backend/`** is shared: same Firebase users, Firestore data, and decision APIs for both clients.

BUY / SELL / WAIT are never computed in the browser — they always come from the backend.

## Quick start — Web PWA

```bash
cd web
cp .env.example .env.local   # fill Firebase + API URL; never commit secrets
npm ci
npm run dev
```

Full setup (Home Screen, push): [docs/WEB_PWA_SETUP.md](docs/WEB_PWA_SETUP.md).  
Cloudflare Pages production deploy: [docs/CLOUDFLARE_PAGES_DEPLOY.md](docs/CLOUDFLARE_PAGES_DEPLOY.md).  
Firebase Auth/API checklist: [docs/FIREBASE_FIRST_DEPLOY.md](docs/FIREBASE_FIRST_DEPLOY.md).

## Quick start — iOS (Phase 1 mock mode)

1. Open `ios/GoldMeta.xcodeproj` in **Xcode 15+** on macOS.
2. Select the **GoldMeta** scheme and an iPhone simulator (iOS 17+).
3. Build and run (`⌘R`).
4. Complete onboarding (mock auth is available in DEBUG).
5. Dashboard loads mock BUY / SELL / WAIT fixtures. Use **Developer → Cycle Fixture** in Settings (DEBUG) to switch scenarios.

No Firebase or TradingView credentials are required for mock mode.

For real Firebase/Auth/Push/API setup on a Mac, start with [docs/MAC_FIRST_RUN_CHECKLIST.md](docs/MAC_FIRST_RUN_CHECKLIST.md) and [docs/IOS_CONFIGURATION.md](docs/IOS_CONFIGURATION.md).

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
| [WEB_PWA_SETUP.md](docs/WEB_PWA_SETUP.md) | Browser PWA install and Web Push |
| [CLOUDFLARE_PAGES_DEPLOY.md](docs/CLOUDFLARE_PAGES_DEPLOY.md) | Cloudflare Pages + goldmeta.metamechsolutions.com |
| [FIREBASE_FIRST_DEPLOY.md](docs/FIREBASE_FIRST_DEPLOY.md) | Exact Firebase env checklist (Auth/API) |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design |
| [DECISION_ENGINE.md](docs/DECISION_ENGINE.md) | Scoring, guards, confidence |
| [MAC_FIRST_RUN_CHECKLIST.md](docs/MAC_FIRST_RUN_CHECKLIST.md) | Exact first-run Mac checklist |
| [IOS_CONFIGURATION.md](docs/IOS_CONFIGURATION.md) | iOS plist, xcconfig, Firebase package setup |
| [PRODUCTION_CONNECTION.md](docs/PRODUCTION_CONNECTION.md) | Connect iOS, Firebase, backend, TradingView, push |
| [END_TO_END_TEST.md](docs/END_TO_END_TEST.md) | Owner validation flow |
| [FIRESTORE_DATA_MODEL.md](docs/FIRESTORE_DATA_MODEL.md) | Firestore collections and fields |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Backend deploy and release checks |
| [TRADINGVIEW_SETUP.md](docs/TRADINGVIEW_SETUP.md) | Pine + alerts |
| [FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md) | Auth, Firestore, Functions |
| [PUSH_NOTIFICATIONS.md](docs/PUSH_NOTIFICATIONS.md) | FCM |
| [SECURITY.md](docs/SECURITY.md) | Webhook + secrets |
| [TESTFLIGHT_SETUP.md](docs/TESTFLIGHT_SETUP.md) | Distribution |
| [USER_GUIDE.md](docs/USER_GUIDE.md) | End-user guide |

## MVP status

Core MVP paths are implemented as source in this tree:

- Progressive Web App (`web/`) with Firebase Auth, dashboard, offline cache, and PWA install support
- Offline SwiftUI app with mock decisions and tests (`ios/` preserved)
- Backend webhook → snapshot → decision engine with tests
- AI explanation with fallback when OpenAI is unavailable
- Push notification service: native FCM + Web Push subscriptions (VAPID server-side)
- Pine bridge + setup docs
- Journal API + basic iOS / web journal UI

**Requires your credentials for live operation:** Firebase project, OpenAI API key (optional AI), Apple push capability (iOS), VAPID keys (Web Push), TradingView alert URL.

## Secret scanning before every push

Never commit real secrets. Before pushing, inspect staged files:

```bash
git status --short
git diff --cached
```

Confirm the diff does not contain `GoogleService-Info.plist`, `Secrets.xcconfig`, Firebase Admin JSON, OpenAI keys, APNs keys, FCM tokens, VAPID private keys, or webhook payload secrets. Commit only `.example` templates.

## License / ownership

User owns their trading data. Export and delete flows are provided. No advertising SDK. No sale of user data.
