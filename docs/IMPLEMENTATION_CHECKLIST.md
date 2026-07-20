# GoldMeta Implementation Checklist

## Phase 1 — Offline iOS prototype
- [x] Repository structure
- [x] ARCHITECTURE.md
- [x] Shared decision models (Swift + JSON schemas)
- [x] Design system (dark + gold)
- [x] Onboarding + disclaimer
- [x] Dashboard (BUY / SELL / WAIT)
- [x] Full analysis
- [x] Signal history
- [x] Settings
- [x] Mock market-data service + fixtures
- [x] Unit tests
- [x] README for opening Xcode project

## Phase 2 — Backend foundation
- [x] Firebase setup docs + .env.example
- [x] Webhook endpoint (validate, dedupe, 202)
- [x] Snapshot normalisation
- [x] Data quality engine
- [x] Deterministic decision + trade-plan engines
- [x] Firestore models + security rules
- [x] Backend unit tests

## Phase 3 — Push + live data
- [x] Device registration endpoints
- [x] FCM notification service
- [x] iOS API client + offline/stale states
- [x] Decision sync endpoints

## Phase 4 — Pine bridge
- [x] GoldMetaBridge.pine v6
- [x] alert-payload-example.json
- [x] TRADINGVIEW_SETUP.md

## Phase 5 — AI layer
- [x] OpenAI service + strict schema
- [x] Versioned system prompt
- [x] Retry + deterministic fallback
- [x] Cost controls

## Phase 6 — Journal + monitoring
- [x] Journal API + statistics
- [x] Active-trade monitoring hooks
- [x] iOS journal screen + metrics

## Phase 7 — Screenshot analysis
- [ ] Photos picker / share extension (scaffolded stub)
- [ ] Manual analysis endpoint (stub)

## Phase 8 — Release prep
- [x] Setup docs suite
- [x] Privacy / terms placeholders
- [x] TestFlight guide
- [x] Security review notes

## MVP definition-of-done mapping
See README.md “MVP status”.
