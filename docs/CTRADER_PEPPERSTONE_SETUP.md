# Pepperstone cTrader setup (GoldMeta)

GoldMeta analyses XAUUSD. Pepperstone cTrader can trade XAUUSD CFDs directly.
Trading 212 Invest remains a separate long-only ETF proxy path.

**No passwords, tokens or secrets belong in this document.**  
**Canonical product architecture:** [`MULTI_USER_AUTOTRADE_ARCHITECTURE.md`](./MULTI_USER_AUTOTRADE_ARCHITECTURE.md)

## Why TradingView alone is insufficient

Connecting Pepperstone to TradingView lets you trade manually from the chart.
It does **not** grant GoldMeta a secure server-side API session.

GoldMeta automation requires:

1. A Pepperstone **cTrader** account (Demo and/or Live — user selectable)
2. A registered **cTrader Open API** application
3. OAuth authorization (PKCE + state) into GoldMeta
4. Explicit account selection (Live requires typed confirmation)

GoldMeta never scrapes or clicks the TradingView order panel.

## Create a Pepperstone cTrader account

1. Open a Pepperstone account that supports **cTrader** (Demo and/or Live).
2. Confirm you can log into the cTrader ID portal.
3. Note that a TradingView-linked Pepperstone login is not automatically an
   Open API-authorised cTrader account.

GoldMeta does not collect your cTrader password.

## Register a cTrader Open API application

1. In the cTrader Open API portal, create an application for the preview environment.
2. Set the redirect URI to the GoldMeta callback provided by ops
   (example shape only):  
   `https://<functions-host>/apiCTraderPreview/v1/ctrader/oauth/callback`
3. Initial preview OAuth uses **`accounts`** scope only — do not request `trading` until approved.
4. Provide `CTRADER_CLIENT_ID`, `CTRADER_CLIENT_SECRET`, and
   `CTRADER_REDIRECT_URI` to Secret Manager — never commit them.

`CTRADER_ENVIRONMENT=DEMO` on the preview function selects the Open API host for that deployment; it is **not** a permanent product rule that Live accounts are impossible.

## OAuth authorization process

1. Owner Auth integrity should be HEALTHY for owner ops gates where applicable.
2. Each verified active user opens Broker Control Centre → Pepperstone cTrader.
3. GoldMeta starts OAuth with CSRF `state` + PKCE challenge.
4. User approves on cTrader ID.
5. Server exchanges code for tokens, encrypts them **per user** server-side, and never
   returns tokens to the browser.

If Auth is unhealthy, owner-facing UI may show **Connection setup required** and OAuth stays
disabled for gated owner flows. Technical codes remain available under “Technical details”.

## How GoldMeta stores tokens

- Access/refresh tokens are encrypted at rest with a server secret (per-user connection doc).
- Tokens are never written to browser storage, logs, or client Firestore writes.
- Disconnect revokes local connection state and invalidates pending previews.

## Demo versus Live

| Mode | Current product architecture | Preview deployment lock |
|------|------------------------------|-------------------------|
| Demo account select / preview | Implemented (per user) | Read/preview only |
| Live account select | Implemented (typed confirmation) | Execution disabled |
| Demo order submission | Implemented path exists | **Temporarily disabled** |
| Live order submission | Implemented path exists | **Temporarily disabled** |
| Demo / Live Auto | Per-user settings exist | **Temporarily OFF** |

These locks are temporary deployment-state controls, not permanent “Live impossible” product design.

## Risk controls

Recommended defaults exist for first-time setup (e.g. €20 risk). Users configure their own risk, lot sizing, daily loss, trade caps, confidence, sessions, and filters. Saved per-user settings are not overridden by defaults.

Broker-derived limits (min/max/step volume from Open API) still apply and may make a chosen risk amount incompatible with symbol minimums — that is correct validation, not silent resizing.

Hard security rules (no cross-user account use, no webhook-forged UID/risk/Live enablement, no martingale/grid/blind retry patterns in the engine) remain structural.

## First controlled Demo order process

Not authorised in this PR.

Future sequence:

1. Auth HEALTHY (owner ops)
2. OAuth + Pepperstone account confirmed
3. XAUUSD metadata + live quotes verified
4. Trade preview READY_FOR_CONFIRMATION
5. Separate owner approval for first Demo BUY / SELL / close
6. Submission remains behind explicit flags

## Emergency STOP

- Scoped by authenticated user and selected environment (Demo/Live)
- Stops new entries for that user/environment
- Does **not** silently liquidate
- Separate future actions: cancel GoldMeta pending order, close position,
  disconnect broker

## TradingView

Each user gets a private hashed webhook and the shared GoldMeta Standard template
(`goldmeta-standard-v1` — schema/formatting only). Optional custom mapping is per user.
Admin publishes the shared template text only; there is no shared admin webhook for signal routing.
