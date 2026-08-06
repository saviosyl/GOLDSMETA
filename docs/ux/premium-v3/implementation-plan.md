# GoldMeta Premium UI V3

## Goal

Rebuild the GoldMeta frontend so the real application closely matches the approved premium mockups rather than applying colours to the previous flat layout.

## Visual target

- Hybrid theme: light page surfaces with navy emphasis cards, header and desktop sidebar
- Plus Jakarta Sans
- Lucide icon system
- Gold for active navigation and PREPARE states
- Green for verified/healthy/bullish states
- Amber for pending/limited states
- Red for invalid/bearish/risk states
- Compact phone-first composition with safe areas

## Phase 1 — shared shell

- Rework `AppShell` desktop sidebar hierarchy and active states
- Compact mobile header and quote row
- Correct Dynamic Island and safe-area spacing
- Premium icon bottom navigation
- Prevent fixed navigation from covering content
- Rebuild notification centre as a fitted bottom sheet / desktop drawer

## Phase 2 — Plan dashboard

- One authoritative market-feed strip
- Mockup-accurate navy decision hero
- Compact 2x2 mobile metric grid
- One action row only
- Premium insight strip
- Segmented Plan / Structure / Momentum / Levels / History tabs
- Structured action-plan card
- Full-width 5M confirmation strip
- Premium accordion sections
- Explicit WAIT / PREPARE / BUY / SELL / INVALIDATED variants

## Phase 3 — Levels

- Structured upside/downside level rows
- Consistent strength badges
- Functional responsive dark level map
- Highlight current price with gold marker
- Compact trade-plan summary
- Plain-language guidance

## Phase 4 — Alerts and setup

- Green setup health card based on real traffic
- Ordinary users never see webhook details
- Notification preferences and recent alerts
- Compact phone notification sheet
- Admin-only technical diagnostics

## Phase 5 — Remaining routes

- Markets overview cards and responsive tables
- Journal summary and premium trade cards/table
- Risk Planner input/result composition
- Research/report hierarchy and accordions
- Settings grouped cards
- Consistent loading, empty and error states

## Responsive acceptance

Test 320, 375, 390, 430, 768, 1024, 1366 and 1440 widths.

Required:

- no horizontal overflow
- no clipped text or controls
- no content beneath fixed navigation
- no duplicated actions
- all drawers inside viewport
- mobile touch targets at least 44px
- desktop content does not appear stretched or empty

## Safety boundaries

Do not change:

- Firebase Auth/users/passwords/UIDs
- Pine/webhook contract
- decision engine or geometry validation
- plan lifecycle
- broker execution

Preserve:

- AutoTrade OFF
- Demo OFF
- Live OFF
- no order submission

## Release

- Work only on `cursor/gpt-premium-ui-v3`
- Open draft PR to `cursor/production-connection`
- Do not deploy feature branch
- Merge only after visual screenshots and tests pass
- Deploy exact merge SHA
