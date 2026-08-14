# GOLD_HUNTER FAST — Phase 2 Data-Capture-Only Collector (DESIGN)

**STATUS: DESIGN ONLY — NOT IMPLEMENTED — NOT DEPLOYED**

This document specifies a dedicated market research collector. It is **not** a trading bot and must not create shadow trades, broker requests, or broker orders.

## Identity (hard invariants)

| Field | Required value |
|-------|----------------|
| permissionScope | `SCOPE_VIEW` only |
| brokerOrders | `0` |
| brokerRequests | `0` |
| shadowOrders | `0` |
| mutationSurface | `NONE` |
| tradingAdapter | **none** — never constructed |
| openShadowTrade | always `false` |
| ENTER / EXIT / P/L | **forbidden** |

Fail-closed: if any invariant is violated at boot or runtime, the process must refuse to start / self-halt capture and set `serviceHealthy=false`.

## Purpose

Collect **independent clean market periods** (Spot + Depth + candidate telemetry + transport timing) so Phase 1-style entry-edge research can obtain genuine chronological DISCOVERY / VALIDATION / HOLDOUT across multiple trading days.

Do **not** tune strategy thresholds during the campaign. Freeze research telemetry schema for the entire campaign.

## Architecture (proposed)

```
┌─────────────────────────────────────────────────────────────┐
│  Cloud Run service: gold-hunter-fast-research-collector     │
│  (SEPARATE from gold-hunter-fast-shadow and Core AutoTrade) │
├─────────────────────────────────────────────────────────────┤
│  OAuth / TokenVault  →  SCOPE_VIEW enforce (fail closed)    │
│  MicroLiveMarketSession (Spot + Depth XAUUSD only)          │
│                                                             │
│  ResearchIngestBridge                                       │
│    - onSpot / onDepth raw callback timestamps               │
│    - enqueue ordered queue (no trading engine)              │
│    - ResearchFeaturePipeline (book + FastFeatureEngine)     │
│    - evaluateSetupsDetailed → A/B/C raw telemetry only      │
│    - NO GhFastEngine trading state machine                  │
│    - NO ShadowExecutionAdapter                              │
│    - NO openShadowTrade / ENTER / EXIT                      │
│                                                             │
│  ResearchDurableSink → local chunks → GCS                   │
│  /health research health JSON (brokerOrders=0 always)       │
└─────────────────────────────────────────────────────────────┘
```

### Explicit non-goals

- Do **not** reuse `GoldHunterFastLiveBridge` as-is if it constructs `ShadowExecutionAdapter` / opens shadow trades.
- Do **not** import Core broker / order adapters.
- Do **not** enable `MICRO_BROKER_EXECUTION_ENABLED`.
- Do **not** write trade P/L rows.

### Preferred reuse (read-only research path)

Reuse (without execution wiring):

- `InMemoryDepthBook`, `FastFeatureEngine`, `evaluateSetupsDetailed`
- `frozenGhFastSoakConfig` (thresholds frozen — observation only)
- Ordered event queue patterns from `eventQueue.ts`
- Durable chunk sink patterns from `durableSink.ts` (new GCS prefix)
- `SCOPE_VIEW` account selection / token vault helpers

New modules (proposed paths — not created as runnable services in this PR beyond design artifacts):

| Proposed file | Role |
|---------------|------|
| `backend/src/services/microEdge/goldHunter/fast/research/researchTypes.ts` | Capture record + health schema |
| `backend/src/services/microEdge/goldHunter/fast/research/nullExecutionGuard.ts` | Compile/runtime proof: no adapter |
| `backend/src/services/microEdge/goldHunter/fast/research/researchFeaturePipeline.ts` | Book+features+A/B/C telemetry |
| `backend/src/services/microEdge/goldHunter/fast/research/researchIngestBridge.ts` | Transport timestamps → queue |
| `backend/src/services/microEdge/goldHunter/fast/research/researchCollector.ts` | NDJSON record writer |
| `backend/src/services/microEdge/goldHunter/fast/research/researchDurableSink.ts` | GCS `gold-hunter-fast/research-capture/` |
| `backend/src/services/microEdge/runtime/fastResearchCaptureRuntime.ts` | Process entry (no trading) |
| `backend/Dockerfile.gold-hunter-fast-research` | Separate image (later) |
| `backend/tests/unit/microEdge/goldHunter/goldHunterFastResearchCaptureSafety.test.ts` | Safety proofs |

## Capture schema (frozen for campaign)

Each market row should include:

### Transport / ordering
- `receiveSeq`
- `brokerTimestampMs` (if present)
- `rawCallbackArrivalMs` (pre-queue)
- `bridgeEnqueueMs`
- `engineProcessMs` (queue dequeue / process time)

### Subscription / session
- `spotSubscribed`, `depthSubscribed`
- WebSocket/session connection state
- `disconnectTs`, `reconnectStartTs`, `reconnectEndTs`, `resubscribeState`

### Queue / lag
- `queueDepth`
- `enqueueToProcessLatencyMs`
- `eventLoopLagMs` / heartbeat

### Market
- SPOT / DEPTH payload
- best bid/ask, spread
- depth availability, crossed state, book generation

### A/B/C raw telemetry (every feature tick)
- `eligible`, `candidateSide`, `rawQuality`, `failedConditions`, `selected`

### Feature snapshot
- `midVel250/500/1s/2s/3s`, `acceleration`, `efficiency1s/3s`
- `signedImbalance1s`, `depthImbalance`, `weightedImbalance`
- liquidity add/remove rates, `updateRate1s`
- touches, distance high/low

### Forbidden fields
- no `openShadowTrade`, no `ENTER`/`EXIT`, no trade P/L, no broker request IDs

## Safety proof (required before any future deploy)

1. **Static:** research runtime must not import `ShadowExecutionAdapter`, `ForbiddenLiveExecutionAdapter`, `GhFastEngine` trading methods that open trades, or Core order clients.
2. **Boot assert:** `brokerExecutionEnabled===false`, `mutationSurface==="NONE"`, `permissionScope==="SCOPE_VIEW"`, `shadowOrders===0`.
3. **Health contract:** `/health` always reports `brokerRequests=0`, `brokerOrders=0`, `shadowOrders=0`.
4. **Unit tests:** constructing research runtime with a trading adapter stub must throw; submitting ENTER intent must be impossible (no adapter method).
5. **Replay/audit:** captured chunks contain zero `decision.action` in `{ENTER_BUY,ENTER_SELL,EXIT}` and zero `tradeExit` records.

## Data campaign design

### Minimum
- **5 separate trading days** of usable clean capture

### Prefer
- **10 separate trading days**

### Session coverage (where possible)
- London morning
- London/NY overlap
- NY session
- Quiet periods
- Volatile periods

### Rules during collection
- Freeze telemetry schema
- Do **not** retune `minSetupQuality`, velocity, spread, stops, trails, A/B/C thresholds
- Do **not** interpret daily P/L (there is none)
- Label stormy/resync-heavy days as infrastructure-contaminated, still retain raw for transport research if clearly tagged

### Independence definition for later research
A day counts as an independent period only if it has continuous Spot+Depth with acceptable resync/gap rates for a multi-hour window. Pseudo-splits within one morning are not OOS.

## Daily data health fields

```
serviceHealthy
spotSubscribed
depthSubscribed
spotAgeMs
depthAgeMs
eventsReceived
eventsDropped
queueDepth
queueLatencyP95
eventLoopLagP95
feedGapCount
reconnectCount
resyncCount
bookCrossedCount
candidateA
candidateB
candidateC
brokerRequests = 0
brokerOrders = 0
shadowOrders = 0
captureStart
captureDuration
runId / datasetId
configSha256
runtimeSha
schemaVersion
```

## Storage plan

| Layer | Path / note |
|-------|-------------|
| Local hot | `.gold-hunter-data/fast-research-capture/<runId>/chunk-NNNNN.ndjson.gz` |
| GCS | `gs://{project}-gold-hunter-fast/gold-hunter-fast/research-capture/<runId>/<YYYY-MM-DD>/` |
| Manifests | per-chunk sha256, rowCount, startTs/endTs, schemaVersion |
| Inventories | daily `CAPTURE_DAY_SUMMARY.json` with health aggregates |
| Separation | **never** write into `live-shadow/` prefix used by V1 shadow soak |

### Retention / volume (estimates)

Assumptions (order-of-magnitude from V1 soak):
- ~500 rows/chunk, ~1–2 chunks/minute when both Spot+Depth active
- Compressed chunk ≈ 70–80 KiB (observed V1)
- ~8 trading hours/day → ~500–1000 chunks/day → **~40–80 MiB compressed/day**
- 10-day campaign → **~0.4–0.8 GiB** compressed (+ manifests)
- Retention proposal: **90 days** hot GCS; archive cold after research freeze; do not delete until Phase 1 OOS campaign completes

If transport timestamps + full specialist telemetry increase size ~1.5–2×, budget **~1–2 GiB / 10 days**.

## Tests required (before any future deploy)

1. `researchCaptureSafety.test.ts` — no execution adapter import / construction
2. Health JSON always zeros broker/shadow counters
3. SCOPE_VIEW fail-closed on SCOPE_TRADE token
4. Chunk schema round-trip (write → gunzip → parse)
5. Resync/gap markers recorded without fabricating trades
6. A/B/C raw telemetry present on feature ticks even when not selected
7. Queue latency / callback timestamp monotonicity invariants
8. Collector never emits ENTER/EXIT/tradeExit

## Deployment confirmation (this Phase)

- **No collector deployed**
- **No Cloud Run service started**
- **No Dockerfile/service wiring merged as live**
- This PR only adds design artifacts + corrected Phase 1 research

## Relationship to Phase 1

Phase 1 corrected analysis still finds:

- `INSUFFICIENT INDEPENDENT DATA FOR OOS VALIDATION`
- `NO POSITIVE PROSPECTIVE ENTRY EDGE FOUND`

Phase 2 exists solely to gather the missing independent clean periods.
