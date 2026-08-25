# Mobile compact UX audit (post V3)

## Pages checked

- Today’s Plan (`OverviewPage`)
- Markets (`IntelligencePage`)
- Journal (`JournalPage`)
- More sheet (`AppShell`)
- Settings (`SettingsPage`)
- Notification centre drawer
- TradingView admin setup
- Login / Register / onboarding status pages
- Risk Planner
- Profile popover / More sheet / sticky action bar / bottom nav

## Problems found (from production screenshots + code)

1. Market feed status card used multi-line title + subtitle + quote + verified → too tall.
2. WAIT heading used oversized clamp (~2.25–4.75rem).
3. Monitoring paragraph and bias notes competed with decision above the fold.
4. Support / resistance appeared after long explanatory copy.
5. Topbar showed AutoTrade badge + subtitle + large avatar cluster.
6. Sticky bottom action buttons used large padding and competed with bottom nav.
7. Notification popover used absolute positioning (`right: 0`) and could overflow the viewport / clip text.
8. Preference rows and event titles could wrap poorly inside a narrow absolute panel.
9. Fixed drawers/action bars risked covering content without enough bottom padding.

## Compact fixes applied

- Feed status → one-line “Market feed: Limited/Operational” with Details disclosure.
- WAIT → compact heading + one-line “No valid plan yet”.
- Fold order: feed → decision → next check → support/resistance → next action → Enable alerts → Why waiting.
- Long explanations moved into Why waiting?
- Notification centre → full-width mobile bottom sheet, `max-width: 100vw`, internal scroll, backdrop scroll lock, Close control clear of bottom nav.
- Topbar / action bar / page title densified under 720px.
- Global `overflow-x: clip` + safe-area padding for 320px+.

## Target fold order (Today’s Plan / WAIT)

1. Compact market-feed status  
2. BUY / SELL / WAIT  
3. One-line plan state (`No valid plan yet`)  
4. Entry / Stop / TP when available  
5. Confirmation state  
6. Next check  
7. Support and resistance  
8. Compact alert button  
9. Detailed explanation below (`Why waiting?`)

## Screenshot assets

| Width | Before | After |
| --- | --- | --- |
| 390px | `before-compact/wait-mobile-390.png` | `after-compact/wait-mobile-390.png` |
| 375px | (same bulky layout as 390 before) | `after-compact/wait-mobile-375.png` |
| 320px | (same bulky layout as 390 before) | `after-compact/wait-mobile-320.png` |
| Drawer | clipped absolute popover | `after-compact/notification-drawer-mobile.png` |

## Responsive tests covered

- No horizontal overflow at 320 / 375 / 390  
- Notification drawer inside viewport (`max-width: 100vw`, left/right 0 on mobile)  
- No clipped notification preference text  
- Bottom nav padding on drawer body  
- Compact WAIT / feed / enable-alerts copy  
- Keyboard / screen-reader labels on close + backdrop  

## Test results

```text
vitest: DecisionDashboard MarketFeedStatus PhoneAlertsControl
        NotificationCentre MobileCompactLayout
→ 5 files, 19 tests passed
```

Production smoke (after deploy `a842d974`):

- Live bundle: `index-pHHUSyOk.js` / `index-O1KFIuiD.css`
- Firebase config present in live JS
- Compact strings present: `No valid plan yet`, `Why waiting?`, `Enable alerts`, `notification-close`
- API health: `ok` / production
- Known pre-existing: missing `/assets/*` still SPA-falls-back HTML 200

## Safety unchanged

AutoTrade OFF · Demo OFF · Live OFF · no trading-logic / Pine / webhook / Auth changes.
