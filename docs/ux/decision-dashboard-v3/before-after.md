# Decision Dashboard V3 Before / After

## Before

- The first mobile screen is crowded by market/feed metadata, stage progress, and repeated safety copy before the user sees the actual decision.
- WAIT states use technical labels such as `WAIT -- NO VALID PLAN` and "Trade levels failed safety validation."
- Notification affordances do not actually start phone-alert setup.
- Normal users are guided toward TradingView/webhook setup even though the market feed is centrally managed.
- Valid-but-pending plans can hide Entry / Stop / TP until the plan is actionable.
- Market bias appears high in the hierarchy and can be mistaken for a signal.

## After

| Area | V3 change |
| --- | --- |
| Primary fold | Feed health, BUY/SELL/WAIT, plain plan state, levels, 5M confirmation, next action, alerts |
| WAIT | "WAIT" and "No valid trade plan yet" first; technical details behind "Why am I waiting?" |
| POTENTIAL | Shows entry zone, stop, TP1/TP2, R:R, expiry, and "Wait for 5-minute confirmation" |
| READY | Shows manual BUY/SELL plan with confirmation passed, confidence, levels, lifecycle, and risk disclaimer |
| Feed | Green/amber/red text status with quote line and last verified time |
| Alerts | Real phone-alert control using explicit opt-in plus in-app notification centre and preferences |
| Details | Research and diagnostics moved below the quick dashboard into remembered collapsible sections |
| TradingView | Hidden for normal users; OWNER/ADMIN keep setup and get admin market-feed status |
| Safety | One compact "Manual plan only" disclaimer; AutoTrade remains visibly OFF elsewhere |

## Screenshot outputs

Generated V3 preview assets live in this directory:

- `wait-mobile.png`
- `potential-mobile.png`
- `ready-mobile.png`
- `admin-feed-status.png`
- `notification-preferences.png`

Existing V2 before notes are in `docs/ux/mobile-plan-v2/before-after.md`.
