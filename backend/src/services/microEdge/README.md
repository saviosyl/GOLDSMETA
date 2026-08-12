# Micro Edge V1 (SHADOW ONLY)

Isolated prediction/research bot. **No broker order path.**

- Namespace: `microEdge/shadow-v1`
- Base production SHA: see `backend/scripts/microEdge/MICRO_BASE_SHA.txt`
- Does **not** import Core AutoTrade or the Core mixed cTrader client
- `MICRO_BROKER_EXECUTION_ENABLED` must remain `false` (fail-closed)

## Market data

Read-only adapter (`marketData/microCTraderClient.ts`):

- M1 / M5 / M15 trendbars (tick volume)
- Bid/Ask spot
- Historical ticks / DOM / live trendbar subs are **feature-gated** until a dedicated persistent Micro collector is deployed
- Dedicated `scope=accounts` OAuth is **not** introduced in V1 (must not disturb Core OAuth)

## Retention

- Immutable predictions + feature snapshots + outcomes are retained for forward research
- Streaming ticks/DOM (when enabled) should use bounded buckets, not one Firestore write per tick

## Versions (V1)

- Feature: `features-v1.0.0`
- Model: `logistic-champion-v1.0.0`
- Label: `label-theta-v1.0.0`
- Cost: `cost-proxy-v1.0.0`
