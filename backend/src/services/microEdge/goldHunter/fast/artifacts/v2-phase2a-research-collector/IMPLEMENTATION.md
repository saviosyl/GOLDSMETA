# GOLD_HUNTER FAST — Phase 2A Research Collector Implementation

**STATUS: IMPLEMENTED — REVIEW CORRECTIONS APPLIED — NOT DEPLOYED**

Stacked on Phase 1 PR #122. Does not modify #119 / #121 / #122.

## Architecture

```
GoldHunterFastResearchCaptureRuntime
  └─ ResearchIngestBridge (ordered queue)
       ├─ ResearchFeaturePipeline (InMemoryDepthBook + FastFeatureEngine + evaluateSetupsDetailed)
       └─ ResearchEventCollector → ResearchDurableSink
            └─ gold-hunter-fast/research-capture/<runId>/<date>/
```

No `GoldHunterFastEngine`. No `ShadowExecutionAdapter`. No ENTER/EXIT/P/L.

## Capture health

| Flag | Meaning |
|------|---------|
| `processHealthy` | Runtime process is up |
| `captureHealthy` | CONNECTED + spot+depth subscribed + ages fresh + zero drops + no fatal persist |
| `serviceHealthy` | Alias of `captureHealthy` (never true while disconnected) |
| `dataIntegrityStatus` | `CLEAN` \| `DEGRADED` \| `FAILED` |
| `campaignValid` | captureHealthy + SCOPE_VIEW verified + CLEAN + GCS (campaign mode) + heartbeats + session telemetry |

## Persistence backpressure

Never silently `pending.shift()` oldest chunk. On queue overflow: `DATA_INTEGRITY_FAILED`, stop accepting, retain written evidence, mark period contaminated.

## Heartbeats / session lifecycle

Independent `HEARTBEAT` rows ~1Hz (even with zero market events). Session poll observes `MicroLiveMarketSession` and persists `SESSION_TRANSITION` for disconnect/reconnect/subscription changes.

## SCOPE_VIEW

`attachSession(session, brokerAuthorizationResponse)` verifies via `parsePermissionScope` / `assertViewOnlyPermissionScope`. SCOPE_TRADE / UNKNOWN / missing → refuse attach.

## Safety invariants

| Field | Value |
|-------|-------|
| mode | RESEARCH_CAPTURE_ONLY |
| permissionScope | SCOPE_VIEW (fail closed) |
| mutationSurface | NONE |
| executionAdapter | NONE |
| brokerRequests/Orders | 0 |
| shadowOrders | 0 |
| openShadowTrade | false |

## Deploy

**DO NOT DEPLOY** in Phase 2A. **DO NOT MERGE** until review sign-off.
