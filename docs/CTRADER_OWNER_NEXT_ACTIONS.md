# Pepperstone cTrader — owner next actions

Branch: `cursor/ctrader-demo-autotrade-ux-c2c2` (PR #43)  
Canonical architecture: [`MULTI_USER_AUTOTRADE_ARCHITECTURE.md`](./MULTI_USER_AUTOTRADE_ARCHITECTURE.md)

**Demo start (in progress):** Pepperstone Demo order submission can be enabled via `CTRADER_DEMO_ORDER_SUBMISSION_ENABLED=true` on `apiCTraderPreview`. Live execution stays hard-locked. Users still need `scope=trading` + a Demo account before Demo Auto activates.

## Checkpoint A — Owner OAuth (accounts scope only)

**Stop here until the owner explicitly approves.**

Do **not** open the cTrader consent page until:

1. Secret Manager secrets exist and are bound to **apiCTraderPreview** only:
   - `CTRADER_CLIENT_ID`
   - `CTRADER_CLIENT_SECRET`
   - `CTRADER_REDIRECT_URI`
   - `CTRADER_TOKEN_ENCRYPTION_KEY`
   - `CTRADER_ENVIRONMENT` = `DEMO` (Open API host for this preview function — not a permanent product-wide Demo-only mode)
2. Exact redirect URI:
   `https://us-central1-goldmeta-web.cloudfunctions.net/apiCTraderPreview/v1/ctrader/oauth/callback`
3. Isolated preview web is serving this branch.
4. Owner (or any verified active user on preview) presses **Connect cTrader** on Broker Control Centre / AutoTrade dashboard.

Initial OAuth scope must be **`accounts`** only. Do not request `trading`.

## Product architecture (already implemented)

- Multi-user per-UID encrypted broker connections
- Demo **and** Live account listing/selection (Live requires typed confirmation)
- Separate Demo/Live AutoTrade settings per user
- Per-user TradingView webhooks + GoldMeta Standard template
- Emergency STOP scoped by user and environment

## Later checkpoints (not started — temporary locks)

- **B** — trading scope (`scope=trading`) after read-only diagnostics pass  
- **C** — first controlled Demo BUY/SELL  
- **D** — enable Demo Auto  
- **E** — Live Auto / Live order execution (separate explicit approvals)  
- **F** — merge + production deploy  

## Temporary hard locks (preview)

- `CTRADER_LIVE_ENABLED=false` / `LIVE_EXECUTION_FEATURE_FLAG=false` — temporary
- Order submission / broker execution flags hard-disabled — temporary
- AutoTrade runtime OFF — temporary
- Do **not** treat “Live accounts rejected” as product design; Live selection is implemented but execution stays locked
- PR #42 (verification email) stays separate and untouched
