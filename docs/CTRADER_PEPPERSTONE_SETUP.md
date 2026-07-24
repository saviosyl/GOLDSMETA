# Pepperstone cTrader Demo CFD setup (GoldMeta)

GoldMeta analyses XAUUSD. Pepperstone cTrader can trade XAUUSD CFDs directly.
Trading 212 Invest remains a separate long-only ETF proxy path.

**No passwords, tokens or secrets belong in this document.**

## Why TradingView alone is insufficient

Connecting Pepperstone to TradingView lets you trade manually from the chart.
It does **not** grant GoldMeta a secure server-side API session.

GoldMeta automation requires:

1. A Pepperstone **cTrader Demo** account
2. A registered **cTrader Open API** application
3. OAuth authorization (PKCE + state) into GoldMeta
4. Explicit Demo account selection and Pepperstone confirmation

GoldMeta never scrapes or clicks the TradingView order panel.

## Create a Pepperstone cTrader Demo account

1. Open a Pepperstone Demo account that supports **cTrader**.
2. Confirm you can log into the cTrader ID portal.
3. Note that a TradingView-linked Pepperstone login is not automatically an
   Open API-authorised cTrader account.

GoldMeta does not collect your cTrader password.

## Register a cTrader Open API application

1. In the cTrader Open API portal, create a **Demo** application.
2. Set the redirect URI to the GoldMeta callback provided by ops
   (example shape only):  
   `https://<functions-host>/apiCTraderPreview/v1/ctrader/oauth/callback`
3. Request trading scopes required for account/symbol/quote access.
4. Provide `CTRADER_CLIENT_ID`, `CTRADER_CLIENT_SECRET`, and
   `CTRADER_REDIRECT_URI` to Secret Manager — never commit them.

Environment for this phase: `CTRADER_ENVIRONMENT=DEMO` only.

## OAuth authorization process

1. Owner Auth integrity must be HEALTHY (pinned UID).
2. Owner opens Broker Control Centre → Pepperstone cTrader.
3. GoldMeta starts OAuth with CSRF `state` + PKCE challenge.
4. Owner approves on cTrader ID.
5. Server exchanges code for tokens, encrypts them server-side, and never
   returns tokens to the browser.

If Auth is unhealthy, the UI shows **Connection setup required** and OAuth stays
disabled. Technical codes remain available under “Technical details” for owners.

## How GoldMeta stores tokens

- Access/refresh tokens are encrypted at rest with a server secret.
- Tokens are never written to browser storage, logs, or client Firestore writes.
- Disconnect revokes local connection state and invalidates pending previews.

## Demo versus Live

| Mode | This phase |
|------|------------|
| Demo read / preview | Architecture ready; needs owner credentials |
| Demo order submission | **Disabled** |
| Demo Auto | **Locked** — qualification gates not reducible |
| Live | **Impossible to activate** |

## Risk controls

Server hard caps (browser may only lower):

- Max risk €20 / trade
- Max one XAUUSD position
- Max three trades / day
- Confidence ≥ 80%
- Signal age ≤ 90 seconds
- Confirmed candle + stop loss required
- No martingale, averaging, grid, pyramiding, blind retry

## First controlled Demo order process

Not authorised in this PR.

Future sequence:

1. Auth HEALTHY
2. OAuth + Pepperstone Demo confirmed
3. XAUUSD metadata + live quotes verified
4. Trade preview READY_FOR_CONFIRMATION
5. Separate owner approval for first Demo BUY / SELL / close
6. Submission remains behind explicit flags

## Emergency STOP

- Stops new entries
- Does **not** silently liquidate
- Separate future actions: cancel GoldMeta pending order, close Demo position,
  disconnect broker

## Troubleshooting

| Symptom | Meaning |
|---------|---------|
| `CTRADER_SETUP_REQUIRED` | Client ID/secret/redirect missing |
| `AUTH_SETUP_REQUIRED` | Pinned owner Auth integrity not HEALTHY |
| `SYMBOL_METADATA_INCOMPLETE` | Refuse to guess lot/min/step |
| `QUOTE_UNAVAILABLE` | No live bid/ask — preview blocked |
| `PREVIEW_APPROVED` | Confirmation only — **no order placed** |

## Release readiness checklist

See in-app Broker Control Centre qualification panel and
`docs/CTRADER_RELEASE_CHECKLIST.md`.
