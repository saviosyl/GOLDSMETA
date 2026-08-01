# Pepperstone cTrader Demo — owner next actions

Branch: `cursor/ctrader-demo-autotrade-ux-c2c2`  
Scope: Demo only. AutoTrade OFF. No Live. No orders until separate approval.

## Checkpoint A — Owner OAuth (accounts scope only)

**Stop here until the owner explicitly approves.**

Do **not** open the cTrader consent page until:

1. Secret Manager secrets exist and are bound to **apiCTraderPreview** only:
   - `CTRADER_CLIENT_ID`
   - `CTRADER_CLIENT_SECRET`
   - `CTRADER_REDIRECT_URI`
   - `CTRADER_TOKEN_ENCRYPTION_KEY`
   - `CTRADER_ENVIRONMENT` = `DEMO`
2. Exact redirect URI:
   `https://us-central1-goldmeta-web.cloudfunctions.net/apiCTraderPreview/v1/ctrader/oauth/callback`
3. Isolated preview web is serving this branch.
4. Owner presses **Connect cTrader** on Broker Control Centre / AutoTrade dashboard.

Initial OAuth scope must be **`accounts`** only. Do not request `trading`.

## Later checkpoints (not started)

- **B** — trading scope (`scope=trading`) after read-only diagnostics pass  
- **C** — first controlled Demo BUY/SELL  
- **D** — enable Demo Auto  
- **E** — merge + production deploy  

## Hard locks

- `CTRADER_LIVE_ENABLED=false`
- `LIVE_EXECUTION_FEATURE_FLAG=false`
- `TRADING212_ORDER_SUBMISSION_ENABLED=false`
- AutoTrade OFF / brokerExecution false / demoOrderSubmission false
- Live accounts rejected
- PR #42 (verification email) stays separate and untouched
