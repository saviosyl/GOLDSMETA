# GOLD_HUNTER FAST — Phase 2A Research Collector Implementation

**STATUS: IMPLEMENTED — NOT DEPLOYED**

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

## Safety invariants

| Field | Value |
|-------|-------|
| mode | RESEARCH_CAPTURE_ONLY |
| permissionScope | SCOPE_VIEW (fail closed on SCOPE_TRADE) |
| mutationSurface | NONE |
| executionAdapter | NONE |
| brokerRequests/Orders | 0 |
| shadowOrders | 0 |
| openShadowTrade | false |

## Files

See PR file list. Static gate: `npm run gate:gold-hunter-research-capture`.

## Deploy

**DO NOT DEPLOY** in Phase 2A.
