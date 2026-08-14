# GOLD_HUNTER FAST — Phase 2B Research Collector Deployment

**STATUS: DEPLOYMENT READINESS — CONTINUOUS RESEARCH SERVICE**

Stacked on Phase 2A (#123). Does not modify #119 / #121 / #122.

## Service

- Cloud Run: `gold-hunter-fast-research-collector`
- Region: `us-central1`
- Mode: `RESEARCH_CAPTURE_ONLY` / `campaignMode=true`
- Continuous across days (no auto-stop after 5)
- Five clean days = earliest analysis checkpoint only (prefer 10+)

## Entry

- `scripts/microEdge/runFastResearchCaptureRuntime.ts`
- `src/services/microEdge/runtime/fastResearchCaptureProcess.ts`
- Dockerfile: `Dockerfile.gold-hunter-fast-research`
- Deploy: `scripts/deployGoldHunterFastResearchCollector.sh`

## Safety

| Invariant | Value |
|-----------|-------|
| executionAdapter | NONE |
| mutationSurface | NONE |
| brokerRequests/Orders | 0 |
| shadowOrders | 0 |
| storagePrefix | `gold-hunter-fast/research-capture/` |
| forbidden | `gold-hunter-fast/live-shadow/` |

SCOPE_VIEW verified from actual `ProtoOAGetAccountListByAccessToken` response via `verifyResearchScopeFromBrokerAuth` before `attachSession`.

## Not included

- No V2 trading strategy
- No shadow trades
- No Core AutoTrade changes
- Do not merge FAST research PR stack in this phase
