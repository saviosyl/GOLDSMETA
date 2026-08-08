# GoldMeta Approved UI Reference — 2026-08-08

These files are the **approved visual source of truth** for the next GoldMeta UI implementation.

The agent must use these references as a close-match target, not as loose inspiration. The production application should reproduce the same overall visual language, information hierarchy, compact density, card proportions, typography scale, spacing, status colours and icon-led usability while continuing to use real GoldMeta data and existing functional controls.

## Reference files

1. `01-broker-account-approved.svg` — primary Broker & Account layout.
2. `02-autotrade-control-approved.svg` — primary AutoTrade Control layout.
3. `03-broker-connected-approved.svg` — connected Broker state reference.
4. `04-main-dashboard-approved.svg` — main GoldMeta decision dashboard reference.
5. `05-tradingview-dashboard-approved.svg` — dashboard/chart treatment reference.

## Implementation rules

- **Do not merely restyle the old layout.** Restructure the frontend components when required so the visible result clearly matches these references.
- Keep the UI **premium, compact, clean and extremely easy to scan**.
- Do not use oversized headings or large empty cards.
- Use bold compact headings, smaller supporting copy and consistent iconography.
- Prefer the project's existing Lucide icons in production rather than emoji where a suitable icon exists.
- Preserve the GoldMeta navy/gold brand identity.
- Use semantic status colours consistently:
  - Green = READY / SUCCESS / CONNECTED / BUY READY / PLAN READY.
  - Amber/gold = PREPARE / WAIT / PENDING / SHADOW MODE.
  - Red = SELL / DANGER / BLOCKED / ERROR / STOP.
  - Blue = information / market data / neutral system state.
  - Grey = inactive / disabled / unavailable.
- **PLAN READY must be green.** PREPARE/WAIT must not appear green.
- Use only real application state and real values. Do not hard-code the example prices/account numbers shown in the references.
- Existing OAuth, broker, AutoTrade, risk and trading logic must continue to function.
- Mobile/iPhone is the primary target, with clean responsive desktop behaviour.
- No clipping, overlap or horizontal overflow.

## Priority interpretation

For Broker, treat `01-broker-account-approved.svg` as the primary visual reference and `03-broker-connected-approved.svg` as a supporting connected-state reference.

For AutoTrade, treat `02-autotrade-control-approved.svg` as the primary visual reference.

For Today's Plan/Home, use `04-main-dashboard-approved.svg` and `05-tradingview-dashboard-approved.svg` together. The real GoldMeta dashboard should adopt their hierarchy and chart/trade-plan treatment without fabricating chart data or indicators.

A result that is only a small CSS change to the current application is **not** considered a match. The change should be immediately obvious when compared side by side with the previous GoldMeta UI.
