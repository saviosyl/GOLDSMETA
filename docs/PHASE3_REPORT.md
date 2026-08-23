# GoldMeta Phase 3 — Intraday Validation Report

## 1. Architecture review

Current production path (preserved):

```
TradingView alert()
  → POST /api/v1/tradingview/webhook/:webhookId
  → validate payload (symbol, timeframe, closed bar, secret/URL auth)
  → rawEvents + processingJobs
  → onDocumentCreated → processJob
  → processDecisionPipeline → DecisionRecord
  → PWA (Dashboard / Analysis / History)
```

Phase 3 adds (analysis-only):

```
DecisionRecord (BUY/SELL)
  → createSetupFromDecision (gated by feature flags)
  → SetupRecord in users/{uid}/setups/{setupId}

Confirmed OHLCV bars (subsequent jobs)
  → updateSetupsFromBar (idempotent per eventId)
  → status transitions + raw/modelled outcomes

Analytics / Diagnostics / Setup detail UI
  → read-only APIs

ExecutionBrokerAdapter + MockBrokerAdapter
  → demo preview only; no IG network; live execution hard-off
```

## 2. Schema changes

New `SetupRecord` (`backend/src/models/setup.ts`) under `users/{uid}/setups/{setupId}`.

Existing `DecisionRecord` documents are **not** rewritten or deleted. Backward compatible with TEST and LIVE decisions.

Journal schema extended with optional `setupId` and `tags` (does not alter engine outcomes).

## 3. Rule configuration

Versioned in `backend/src/config/setupLifecycleConfig.ts`:

- `setup-rules-1.0.0`
- Limits: max 1 active setup, expiry 8 bars, confidence/RR floors, cooldowns
- Sessions: ASIA / LONDON / OVERLAP / NEWYORK / UNKNOWN (collect-only; no blocking without evidence)
- Ambiguity: `WORST_CASE_SL_FIRST`
- Management model knobs: TP1 BE, partial %, TP2 trail hint

Env overrides:

- `SETUP_TRACKING_ENABLED`
- `SETUP_TRACKING_ENVIRONMENTS` (default `TEST`)
- `NEW_SETUP_CREATION_ENABLED`
- `ANALYSIS_GENERATION_ENABLED`

## 4. Exact lifecycle rules

Statuses: `SIGNAL_CREATED` → `WAITING_FOR_ENTRY` → `ENTRY_TRIGGERED` → (`TP1_HIT` / `BREAKEVEN` / `TP2_HIT`) → `TP3_HIT` | `STOP_LOSS_HIT` | `EXPIRED` | `INVALIDATED` | `AMBIGUOUS_INTRABAR` → `CLOSED`.

- WAIT never creates a setup
- One setup per decisionId (idempotent)
- Max one active setup at a time
- Entry on confirmed subsequent bars when price range includes entry
- No entry if SL or TP already reached before fill → `INVALIDATED`
- Expiry after `setupExpiryBars` without fill

## 5. Same-candle ambiguity policy

If a single confirmed candle touches **both** SL and any TP (tick order unknown):

1. Mark `AMBIGUOUS_INTRABAR`
2. Resolve with **WORST_CASE_SL_FIRST** → `AMBIGUOUS_WORST_CASE_SL`, raw R = −1
3. Never silently choose TP before SL

## 6. Entry and expiry methodology

- Timeframe: 15m confirmed bars only
- Entry: bar high/low must bracket entry price (MARKET/LIMIT)
- Expiry: `barsOpen > setupExpiryBars` (default 8) while waiting
- Duplicate `eventId` ignored; bars at/before signal `barTime` ignored
- Malformed OHLC rejected

## 7. Session methodology

Session stored on each setup from decision `currentSession`. Performance broken down by session in analytics. No session hard-blocks in this phase.

## 8. Trade-management modelling methodology

Stored separately:

- **Raw** outcome: market path without management assumptions
- **Modelled** outcome: optional TP1 partial close % + BE notes

Never mixed in a single metric. Analytics use **raw** R.

## 9. Files changed (high level)

Backend: setup services, config, routes, storage, processJob/pipeline hooks, mock execution broker, firestore rules/indexes, tests.

Web: Dashboard status strip, DecisionCard setup strip, History filters, Analytics / Setup detail / Diagnostics pages, Journal tags, API client, tests, CSS.

Docs: this report.

`ios/` untouched.

## 10. Firestore rules / indexes

- Rules: owner read on `users/{uid}/setups/**`; writes server-only
- Indexes: setups by `decisionId`, `environment`, `status` + `createdAt`

## 11. Backend tests

`setupLifecycle.test.ts` — BUY/SELL lifecycle, WAIT, expiry, invalidation, duplicate bars, out-of-order, ambiguity, analytics separation, malformed OHLC, mock broker safety.

All backend: **90 passed**.

## 12. Frontend tests

DecisionCard setup rendering, Analytics empty/small-sample, Setup timeline, Diagnostics access, History filters, Dashboard system status.

All web: **40 passed**.

## 13. Build result

- Backend `tsc` + eslint: pass
- Web lint + typecheck + production build: pass

## 14. Deployment steps (staged)

1. Deploy backend with default flags (TEST tracking only) — Stage 2
2. Verify TEST fixtures create/update setups
3. Set `SETUP_TRACKING_ENVIRONMENTS=TEST,LIVE` for Stage 3
4. Deploy web UI (Stage 4)
5. Do **not** enable IG orders or live broker execution

## 15. Feature-flag states (defaults)

| Flag | Default |
|------|---------|
| analysisGenerationEnabled | true (TV pipeline preserved) |
| setupTrackingEnabled | true |
| setupTrackingEnvironments | `["TEST"]` |
| newSetupCreationEnabled | true |
| brokerLiveExecutionEnabled | **false** (hard) |
| brokerDemoOnlyEnabled | true |
| igOrdersEnabled | false (not exposed) |
| AI_ENABLED | false (unchanged) |

## 16–19. Sample lifecycles

Covered by unit tests:

- BUY entry → TP1 → TP2 → TP3
- SELL entry → SL
- Expiry without fill
- Same-candle SL+TP → AMBIGUOUS worst-case SL

## 20. Analytics UI

Mobile-first `/analytics` with LIVE/TEST toggle, completed/win rate/avg R/cumulative R, session and BUY/SELL breakdowns, empty state + small-sample warning. No profitability claims.

## 21. Security review

- No webhook secrets in diagnostics UI
- Setup/journal writes server-side only
- Broker credentials never in frontend
- Notification failures non-fatal
- Live execution hard-disabled

## 22. Broker-neutral interface

`ExecutionBrokerAdapter` in `executionBroker.ts`: getAccounts, getMarket, getQuote, getOpenPositions, previewOrder, placeDemoOrder, amendDemoOrder, closeDemoPosition, getOrderStatus.

Existing trading-mode `BrokerAdapter` unchanged.

## 23. IG demo adapter plan

Documented in `IG_DEMO_ADAPTER_PLAN` on mock adapter. No real/demo IG orders until separate approval.

## 24. Known limitations

- Stage 2 default: LIVE setups not created until env enables LIVE
- Modelled R is partial-at-TP1 only (simple); not a full portfolio sim
- Diagnostics are authenticated-user scoped (not admin-claim restricted yet)
- Cooldown bars after SL are configured but not yet enforced as a hard gate in createSetup
- No tick data — bar OHLC only

## 25. Next controlled production validation

1. Deploy Stage 2 backend (TEST tracking)
2. Run in-app TEST alert → confirm setup created
3. Feed subsequent confirmed TEST bars → verify transitions
4. Review Analytics (TEST) for empty/small-sample honesty
5. Only then enable LIVE tracking via env
6. Keep broker execution off

**Profitability is not proven. Analysis only. No automatic trading.**
