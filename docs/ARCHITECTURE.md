# GoldMeta Architecture

GoldMeta is a personal XAUUSD trading assistant. It receives structured market data from TradingView alerts, evaluates setups with a deterministic rule engine, uses AI only for explanation and conflict review, and delivers BUY / SELL / WAIT decisions to an iPhone app via push notifications.

## Product principles

1. XAUUSD only in MVP; symbol model is extensible.
2. iPhone portrait-first.
3. Works without a PC after initial TradingView alert setup.
4. TradingView → secure webhook → backend (never scrape, never store TV passwords).
5. Deterministic math for prices, risk, SL, targets, and safety rules.
6. AI explains and reviews; it does not invent market data or override hard guards.
7. Default to WAIT on incomplete, stale, contradictory, or unreliable data.
8. No automatic trade execution in MVP.
9. API keys and secrets stay on the backend.
10. Full audit trail for every decision.

## Disclaimer (onboarding + settings)

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## High-level event flow

```text
TradingView Alert
        ↓
Secure HTTPS Webhook  (POST /webhooks/tradingview/{webhookId})
        ↓
Validate + Deduplicate + Store Raw Event
        ↓
HTTP 202 (immediate)
        ↓
Background worker (Cloud Tasks / Firestore trigger)
        ↓
Merge Indicator Events → Normalised Market Snapshot
        ↓
Data Quality Engine
        ↓
Deterministic Decision Engine → Trade Plan Engine
        ↓
AI Explanation + Conflict Review (optional, cost-controlled)
        ↓
Final Safety Validation
        ↓
Store Decision + Push Notification
        ↓
iOS Dashboard / History / Journal
```

## Repository layout

```text
GoldMeta/
├── ios/                 # Native SwiftUI iPhone app (iOS 17+)
├── backend/             # Firebase Cloud Functions (TypeScript)
├── pine/                # TradingView Pine Script bridge
├── shared/schemas/      # JSON Schema / Zod-aligned contracts
└── docs/                # Setup and design documentation
```

## Components

### iOS (`ios/`)

- SwiftUI + MVVM / feature modules
- Firebase Auth + FCM
- Keychain for tokens; SwiftData for local cache
- Mock mode for offline development
- Screens: Onboarding, Dashboard, Full Analysis, History, Journal, Settings

### Backend (`backend/`)

- Node.js + TypeScript (strict)
- Firebase Cloud Functions gen2
- Firestore + Admin SDK + FCM
- Zod validation
- OpenAI Responses API (server-side only)
- Modules: webhook, snapshot merge, data quality, decision engine, trade plan, AI review, notifications, journal

### Pine bridge (`pine/`)

- `GoldMetaBridge.pine` (v6): confirmed-bar JSON alerts, non-repainting, null for unavailable fields
- Proprietary indicators arrive as separate alerts and are merged on the backend

## Decision pipeline (deterministic first)

1. **Data quality** → GOOD | PARTIAL | STALE | CONFLICTED | INVALID  
   Hard rule: stale/invalid → WAIT
2. **Scoring** (−100 … +100) with versioned weights
3. **Thresholds** (configurable): BUY ≥ +70, SELL ≤ −70, else WAIT
4. **Hard guards** (RR, SL validity, HTF conflict, provisional rules, etc.)
5. **Trade plan** (entry, SL, TP1–3, RR, breakeven, early exit)
6. **AI review** (explain + conflict; may recommend WAIT downgrade only)
7. **Safety validation** → final stored decision

Confidence = setup quality / completeness, **not** win probability.

## Security

- Webhook: path secret + optional payload secret + timestamp + replay protection + dedupe + rate limit + schema validation
- User APIs: Firebase ID tokens
- Restrictive Firestore rules
- No secrets in iOS binary or webhook URLs beyond the opaque webhook ID
- Sanitised structured logs

## Data model (Firestore)

```text
users/{userId}
  devices/, settings/, webhookConnections/
  rawEvents/, marketSnapshots/, decisions/
  journalEntries/, notificationEvents/, auditEvents/
system/configurations/{version}
system/health/{service}
```

## Implementation phases

| Phase | Scope |
|-------|--------|
| 1 | Architecture, SwiftUI prototype, mock data, tests |
| 2 | Backend foundation, webhook, decision engine |
| 3 | Push + live API client |
| 4 | Pine Script bridge |
| 5 | AI explanation layer |
| 6 | Journal + active-trade monitoring |
| 7 | Screenshot analysis (later) |
| 8 | Release / TestFlight prep |

## Non-goals (MVP)

- Automatic broker order execution
- Scraping TradingView
- Guaranteed profitability claims
- Advertising / unnecessary analytics SDKs
