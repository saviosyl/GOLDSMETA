# Multi-user cTrader AutoTrade Architecture

Canonical product architecture for GoldMeta AutoTrade and TradingView integration.

**Status:** Implemented in PR #43. Execution remains **temporarily disabled** for preview safety.  
**Not permanent product limitations:** Demo-only mode, owner-only AutoTrade, shared webhook, or fixed €20 risk.

---

## Implemented architecture

### Broker connections (per user)

- Each approved/verified user has an independent OAuth connection at  
  `users/{uid}/ctraderConnection/current`.
- Access tokens and refresh tokens are encrypted at rest (AES-256-GCM).
- Tokens are never returned to the browser.
- Authorised Demo and Live accounts are listed from the user’s own connection.
- Selected account is stored per user (`selectedAccountId`, `selectedAccountType`).
- Live selection requires an explicit typed confirmation (`confirmLiveSelection`).
- Demo settings never silently enable Live execution.

### AutoTrade settings (per user, per environment)

- Settings documents: `users/{uid}/autotradeSettings/{demo|live}`.
- Demo and Live are separate; no inheritance.
- User-controlled fields include:
  - account type and broker account selection
  - enabled / emergency stop
  - risk mode (fixed EUR or % of equity)
  - risk amount / risk percentage
  - lot-sizing mode (automatic or manual)
  - manual lot size
  - max daily loss, max trades/day, max open positions
  - min confidence, risk/reward, max spread, max quote age
  - cooldowns, sessions, confirmation filters
  - break-even, trailing stop, partial take profits
- Recommended defaults exist for first-time setup only and do **not** override saved user settings.

### TradingView (standard template + per-user webhooks)

- **GoldMeta Standard TradingView Template** (`goldmeta-standard-v1`):
  - formatting and schema only
  - no admin webhook secret, UID, broker token, account ID
  - no private signal history
  - no owner risk or AutoTrade state
- Each user receives:
  - unique webhook ID + unique secret (shown once)
  - hashed secret storage (SHA-256)
  - private TradingView status and signal history
  - optional custom mapping (symbol aliases / timeframe aliases)
  - own decision-engine routing via webhook path UID
- Admin publishes the shared template text only (`/admin/tradingview-template`).

### Access and isolation

- Ordinary verified active users (`USER_APPROVED`) receive AutoTrade configuration access.
- Owner/admin retain admin capabilities; ordinary users cannot access another user’s data.
- Emergency STOP is scoped by authenticated UID and selected environment.
- Browser cannot select another user’s broker account.
- Webhook payload cannot change UID, broker account, AutoTrade enablement, risk settings, or force Live execution.

### UI

- Responsive Broker and AutoTrade surfaces (desktop / tablet / mobile).
- Account-type selector, Live confirmation gate, settings forms, TradingView setup page.

---

## Not yet activated (temporary deployment locks)

These are **preview / deployment-state locks**, not permanent product design:

| Lock | Current value |
|------|----------------|
| OAuth scope | `scope=accounts` only — do **not** request `scope=trading` |
| AutoTrade runtime | OFF |
| Broker order submission | Disabled |
| Demo order execution | Disabled |
| Live order execution | Disabled |
| Live Auto activation | Disabled |
| Production deployment | Unchanged — do not merge/deploy this PR as production activation |

When intentionally enabling later: request trading scope, flip execution flags after explicit owner approval, and keep per-user isolation.

---

## Related docs

- Historical Stage/V4 audit notes under `docs/` may describe older Demo-only or owner-preview states — treat those as **historical**, not current product rules.
- PR #42 (email delivery) remains a separate branch/PR.
