# Micro Edge V1 (SHADOW ONLY)

Isolated prediction/research bot. **No broker order path.**

- Namespace: `microEdge/shadow-v1`
- Base production SHA: see `backend/scripts/microEdge/MICRO_BASE_SHA.txt`
- Does **not** import Core AutoTrade or the Core mixed cTrader client
- `MICRO_BROKER_EXECUTION_ENABLED` must remain `false` (fail-closed)

## Market data

Read-only adapter scaffold (`marketData/microCTraderClient.ts`):

| State | Meaning |
|-------|---------|
| `INTERFACE_READY` | Methods/types exist |
| `MOCK_SEEDED` | In-memory test/offline injection only |
| `LIVE_NOT_CONNECTED` | **V1 default** — no genuine cTrader OpenAPI session |
| `FEATURE_GATED` | DOM / ticks / live trendbar subs pending Micro collector |

Until live OpenAPI reads are wired, status/UI must report **Market feed not connected**.
Do **not** import Core `services/broker/ctrader`.
Dedicated `scope=accounts` OAuth is **not** introduced in V1.

## Retention

- Immutable predictions + feature snapshots + outcomes are retained for forward research
- Streaming ticks/DOM (when enabled) should use bounded buckets, not one Firestore write per tick

## Versions (V1)

- Feature: `features-v1.0.0`
- Model: `logistic-champion-v1.0.0`
- Label: `label-theta-v1.0.0`
- Cost: `cost-proxy-v1.0.0`
