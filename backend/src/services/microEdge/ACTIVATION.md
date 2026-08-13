# Micro Edge — Read-Only Activation Layer

**Stack**

```
cursor/production-connection
  → #113 cursor/micro-edge-v1          (prediction/research scaffold)
  → #114 cursor/micro-edge-market-data-v1  (read-only market-data protocol)
  → NEW  cursor/micro-edge-readonly-activation-v1  (OAuth + vault + collector + historical quotes)
```

**DO NOT MERGE / DO NOT DEPLOY** until review.

## Safety

- `MICRO_SHADOW_ONLY=true`
- `MICRO_BROKER_EXECUTION_ENABLED=false`
- `mutationSurface=NONE`
- No Core AutoTrade imports
- No Core `CTRADER_ACCESS_TOKEN` / `CTRADER_REFRESH_TOKEN` reuse
- OAuth scope = `accounts` only (never `trading`)

## Required secrets / env (deployment — not this PR)

| Name | Purpose |
|------|---------|
| `MICRO_CTRADER_CLIENT_ID` | Open API app client id (may match Core app registration) |
| `MICRO_CTRADER_CLIENT_SECRET` | Open API app secret |
| `MICRO_CTRADER_REDIRECT_URI` | Must match cTrader app redirect, e.g. `https://<web-host>/micro-edge/connect/callback` |
| `MICRO_CTRADER_ENVIRONMENT` | `DEMO` (default for first activation) |
| `MICRO_CTRADER_` + `TOKEN_ENCRYPTION_KEY` | ≥32 chars AES key for Micro token vault |
| `MICRO_QUOTE_SAMPLE_INTERVAL_MS` | default `5000` |
| `MICRO_HISTORICAL_QUOTE_BACKFILL_DAYS` | default `30` |
| `MICRO_BROKER_EXECUTION_ENABLED` | must be `false` |
| `MICRO_COLLECTOR_HEALTH_PORT` | collector health HTTP port (e.g. `8089`) |
| `MICRO_COLLECTOR_VAULT_UID` | optional — vault uid for worker |

Dynamic access/refresh tokens are **not** permanent env vars — they live in the encrypted Micro vault after user OAuth.

## User action after deploy

1. Register redirect URI on the cTrader Open API application.
2. Open Micro Edge → **Connect Micro Edge — Read Only** → Continue.
3. Approve **scope=accounts** in cTrader.
4. Return to callback; Micro stores encrypted tokens server-side.

## Collector runtime (prepared, not deployed)

```bash
npm run micro-edge:collector
```

- Persistent process (Cloud Run min-instances=1 pattern recommended)
- Health: `GET http://0.0.0.0:$MICRO_COLLECTOR_HEALTH_PORT/`
- Shutdown: SIGTERM/SIGINT → disconnect fail-closed
- Reconnect: bounded exponential; re-auth + re-subscribe; never keep stale LIVE_CONNECTED

## CLI (read-only)

```bash
npm run micro-edge:backfill                 # bars
npm run micro-edge:backfill-boundary-quotes # historical Bid/Ask → boundary quotes
npm run micro-edge:diagnostics
```

## Firestore paths (exact)

```
microEdge/shadow-v1/private/oauth/tokens/{uid}
microEdge/shadow-v1/private/oauth/sessions/{sessionId}
microEdge/shadow-v1/marketData/_/barsM1|{barsM5|barsM15}/{id}
microEdge/shadow-v1/marketData/_/quotes/{id}
microEdge/shadow-v1/marketData/_/boundaryQuotes/{id}
microEdge/shadow-v1/marketData/_/checkpoints/{M1|M5|M15|BOUNDARY_QUOTES}
microEdge/shadow-v1/marketData/_/collectorStatus/heartbeat
microEdge/shadow-v1/marketData/_/collectorStatus/runtime
microEdge/shadow-v1/marketData/_/symbolMetadata/current
```

Client rules deny all `microEdge/**`. Admin/backend only.

## Storage mode

- Deployed: `MICRO_STORAGE_MODE=firestore` required (memory fail-closed)
- Test/local: memory allowed
- Token vault, OAuth sessions, market data, collector status share the same mode
