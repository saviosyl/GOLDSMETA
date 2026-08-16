# Gold Hunter selector Demo execution — selective reuse from PR #126

## Base

- `cursor/production-connection` @ `bd5c6a94135f20314ad67475b37cf679035552eb` (PR #131)
- Lifecycle follow-up branch: `cursor/gold-hunter-demo-lifecycle-final-ffd6`
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
| `exits.ts` | `updateOpenTrade` / `evaluateOpenExit` (position manager) |
| Feature pipeline pattern | Adapted from `researchFeaturePipeline` (no research collector) |

## Deliberately NOT imported

- Research Cloud Run / GCS capture
- Research collector lifecycle / reconnect storm
- Research UI
- Offline replay runtime
- `nullExecutionGuard` / research-only wrappers
- `GoldHunterFastEngine` / shadow `executionAdapter` / `liveBridge`
- Fast AutoTrade (`FAST_AUTOTRADE_V1`) anything

## Production additions

- `GoldHunterStrategySelector` — display candidate vs `newOpportunity`
- Durable opportunity id (`GH-OPP-…`) + Firestore signal claims
- `demoAutoExecutionRuntime` — **production call site** for `attemptGoldHunterDemoExecution` (worker/feed, not UI)
- `demoPositionManager` — frozen exits + broker close/tighten
- Throttled selector runtime persistence + bounded exec/position queues
- Demo AutoTrade remains **OFF** after deploy
