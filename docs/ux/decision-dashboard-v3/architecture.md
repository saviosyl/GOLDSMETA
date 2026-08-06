# Decision Dashboard V3 — Shared Feed & Notifications

## Shared-feed architecture

1. Owner/admin configures **one** TradingView webhook connection (roles `PLAN_15M`, `CONFIRM_5M`, `QUOTE_1M` all post to the same URL).
2. Shared feed source UID = `GOLDMETA_PINNED_OWNER_UID` (optional override `GOLDMETA_SHARED_FEED_UID`).
3. Accepted webhook traffic for that UID is recorded in `sharedMarketFeed/current` by alert role.
4. `GET /v1/decisions/latest` reads decisions + session plan from the shared feed UID so all approved users see the same XAUUSD plan.
5. Release-safe cutover: if the shared feed has never stored decisions, the API falls back to the caller’s own decision store.
6. User-private data remains per-UID: journal, risk preferences, followed-plan state, notes, notification preferences, device/push subscriptions.

## Green / amber / red health rules

| Status | Meaning | Rule |
| --- | --- | --- |
| GREEN | All systems operational | Recent Bridge 3.0 / schema 1.1 `PLAN_15M` (tf 15, `chartMatchesRole`) **and** matching recent `CONFIRM_5M`. `QUOTE_1M` optional. |
| AMBER | Market feed partially available | Healthy `PLAN_15M`, but `CONFIRM_5M` missing / stale / source-key mismatched. |
| RED | Market feed unavailable | Required `PLAN_15M` missing, stale, legacy 2.x, role/timeframe mismatch, or unsafe. |

Quote line (never blocks green):

- Healthy recent `QUOTE_1M` → “Live price updates active”
- Otherwise → “Live quote updates limited”

Health is derived from **accepted webhook traffic**, not wizard checkboxes.

## Phone notifications

- Delivery: Web Push (VAPID) + FCM device tokens for signed-in approved users.
- Permission requested only after “Enable phone alerts”.
- In-app notification centre works even when push is denied/unsupported.
- Lifecycle events: `VALID_PLAN_CREATED`, `ENTRY_ZONE_APPROACHING` (cooldown), `ENTRY_ZONE_REACHED`, `CONFIRM_5M_PASSED`, `CONFIRM_5M_FAILED`, `PLAN_INVALIDATED`, `PLAN_EXPIRED`, `TP1_REACHED`, `TP2_REACHED`.
- Preference groups default **OFF** until explicitly enabled.
- Dedup key: `uid:planId:lifecycleEvent:sourceEventId`.
- Service worker `public/push-handler.js` handles push display + notification click → open plan.

## Safety locks preserved

- AutoTrade OFF
- Demo order submission OFF
- Live execution OFF
- No order submission paths added
- Firebase Auth users / passwords / UIDs untouched
- PR #42 and PR #49 untouched
