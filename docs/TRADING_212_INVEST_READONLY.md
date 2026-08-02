# Trading 212 General Invest — Secret Manager setup (read-only)

**Phase:** owner-only read-only connection + GoldMeta paper trading  
**Order submission:** disabled (`T212_ORDER_SUBMISSION_ENABLED=false` and related flags remain false)  
**Do not paste credentials into chat, GitHub, Cursor, PR comments, source, or browser storage.**

## Required secrets

Create these in Google Secret Manager for project `goldmeta-web` (names exact):

| Secret name | Purpose |
|---|---|
| `T212_API_KEY` | Trading 212 Public API key (**read-only** permissions only) |
| `T212_API_SECRET` | Trading 212 Public API secret |
| `T212_ENVIRONMENT` | `PRACTICE` or `LIVE` (read-only; Live still cannot submit orders from GoldMeta) |

Optional legacy aliases still recognised by the client for Practice:

- `T212_DEMO_API_KEY`
- `T212_DEMO_API_SECRET`

## Permission requirements

The API key must allow **read** only:

- account summary
- positions
- instruments metadata
- historical / pending order **reads**

Do **not** enable:

- placing orders
- modifying orders
- cancelling orders

## Wire to Cloud Functions (when owner approves a later deploy)

Map Secret Manager secrets to function environment / secret bindings. Example (ops only):

```bash
# Illustrative — run only with owner approval; do not commit secret values.
gcloud secrets versions access latest --secret=T212_API_KEY --project=goldmeta-web
```

GoldMeta never logs Authorization headers or raw secret values.

## Verification checklist

1. Owner opens Broker Control Centre → Trading 212 General Invest  
2. Connection status becomes `CONNECTED` after secrets are bound  
3. Account id is masked  
4. Positions / cash / portfolio values appear when the broker returns them  
5. Search + watchlist work for stocks/ETFs  
6. CFD / XAUUSD candidates are rejected  
7. Paper BUY / SELL OWNED never call Trading 212 order endpoints  
8. AutoTrade remains OFF  

## Explicit non-goals

- No production merge/deploy from this PR alone  
- No real, Demo, Live or Practice order submission  
- No Auth / owner / webhook changes  
- No cTrader (PR #37) changes  
