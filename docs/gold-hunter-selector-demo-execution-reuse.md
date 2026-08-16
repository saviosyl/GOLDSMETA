# Gold Hunter selector Demo execution — selective reuse from PR #126

## Base

- `cursor/production-connection` @ `bd5c6a94135f20314ad67475b37cf679035552eb`
- Branch: `cursor/gold-hunter-selector-demo-execution-ffd6`
- Does **not** merge PR #126 wholesale

## Reused pure components (ported under `goldHunterAdmin/abc/`)

| Component | Role |
|-----------|------|
| `ctraderMarketNormalize.ts` | `CTRADER_NORMALIZED_V1` Spot/Depth normalize |
| `depthBook.ts` | In-memory Level-II book + bookGeneration |
| `depthRecovery.ts` | Depth validity / RESYNC_RECOVERY |
| `depthProtocol.ts` | ProtoOA depth quote parsing |
| `features.ts` | `FastFeatureEngine` |
| `setups.ts` | `evaluateSetupsDetailed` A/B/C (thresholds unchanged) |
| `frozenConfig.ts` / `defaults.ts` / `types.ts` / `versions.ts` | Frozen config identity |
| `exits.ts` | GH open-trade exit helpers (for future position mgmt) |
| Feature pipeline pattern | Adapted from `researchFeaturePipeline` (no research collector) |

## Deliberately NOT imported

- Research Cloud Run / GCS capture
- Research collector lifecycle / reconnect storm
- Research UI
- Offline replay runtime
- `nullExecutionGuard` / research-only wrappers
- `GoldHunterFastEngine` / shadow `executionAdapter` / `liveBridge`
- Fast AutoTrade (`FAST_AUTOTRADE_V1`) anything

## Production additions (this PR)

- `GoldHunterStrategySelector` + durable Firestore signal claims
- Truthful Demo broker fill/reject/timeout handling
- Protection geometry from frozen `hardStop`
- Quote worker additive Depth subscribe + GH feed hook
- Demo AutoTrade remains **OFF** after deploy
