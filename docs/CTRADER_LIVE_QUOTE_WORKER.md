# Pepperstone live XAUUSD quote worker

## Architecture honesty

| Path | Persistent Spotware WebSocket? | Role |
|------|--------------------------------|------|
| `GET /v1/ctrader/live-quote` (Cloud Function) | **No** — opens WS, takes ticks/snapshot, closes | Serves authenticated dashboard snapshots |
| `refreshCTraderLiveQuotes` (1-minute scheduler) | **No** — one-shot refresh per minute | Keepalive fallback only |
| `scripts/runPersistentQuoteWorker.ts` | **Yes** — long-lived subscribe | Continuous tick ingestion into Firestore |

Cloud Functions request handlers **cannot** reliably hold a Spotware WebSocket between HTTP requests. Continuous pricing requires the always-on worker.

## Always-on worker

- Code: `backend/src/services/broker/ctrader/persistentQuoteWorker.ts`
- Entrypoint: `backend/scripts/runPersistentQuoteWorker.ts`
- Container: `backend/Dockerfile.quote-worker`
- Health: `GET /healthz`

Required secrets (inject — never paste in chat):

- `CTRADER_CLIENT_ID`
- `CTRADER_CLIENT_SECRET`
- `CTRADER_TOKEN_ENCRYPTION_KEY`
- `CTRADER_REDIRECT_URI`
- `CTRADER_QUOTE_OWNER_UID` or `GOLDMETA_PINNED_OWNER_UID`
- Firebase Admin credentials for Firestore

Optional:

- `CTRADER_QUOTE_PERSIST_MIN_MS` (default 250) — throttle Firestore writes
- `CTRADER_QUOTE_PREFER_STORE=true` on API — serve store only (no per-request WS)

## Official authorisation

In-app (preferred): sign in → **Brokers** → Connect cTrader  
URL: `https://goldmeta.metamechsolutions.com/brokers`

cTrader Open API consent base:  
`https://id.ctrader.com/my/settings/openapi/grantingaccess/`

Complete OAuth URLs are generated server-side with PKCE + allowlisted redirect and must not be hand-built with secrets in chat.

## Live orders

Live order submission remains hard-locked (`isCTraderLiveEnabled() === false`).
This worker is for **dashboard pricing only**.
