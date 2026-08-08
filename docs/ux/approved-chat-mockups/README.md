# GoldMeta Approved UI Mockups — Source of Truth

These references represent the UI direction explicitly approved by the product owner in the ChatGPT GoldMeta cTrader OAuth / premium UI review on 2026-08-08.

## Agent instruction — IMPORTANT

Do **not** treat these as loose inspiration. For the relevant screens, match the approved visual composition as closely as practical while using real GoldMeta data and preserving working behaviour.

The UI must be an obvious structural redesign, not a small CSS pass over the old screens.

Reference files in this folder:

- `01-plan-dashboard-approved.jpg` — Today's Plan / main trading dashboard
- `02-broker-approved.jpg` — Broker / Pepperstone cTrader control centre
- `03-autotrade-approved.jpg` — AutoTrade Control / Shadow Mode

The checked-in image copies are downscaled visual references because the repository connector used to add them has a binary-transfer size limitation. Their layout, hierarchy, colours, card composition and visual language are authoritative. Do not use them for reading tiny example numbers/text; use live GoldMeta values and the requirements below.

## Common visual language

- Premium modern fintech/trading UI
- GoldMeta dark navy structural/header colour
- Gold accent for brand and selected navigation
- White/light content cards
- Green = READY / CONNECTED / SUCCESS / BUY READY
- Amber/gold = PREPARE / WAIT / SHADOW / PENDING
- Red = DANGER / ERROR / BLOCKED / SELL READY where appropriate
- Blue = information / market data / neutral system information
- Grey = disabled / unavailable
- Compact typography; no oversized hero text
- Bold, compact headings
- Meaningful consistent icons throughout
- Consistent rounded cards, subtle borders/shadows, restrained spacing
- iPhone-first and responsive

## State-colour rule

This rule is mandatory:

- `PLAN READY` must be GREEN.
- `BUY READY` must be GREEN.
- `PREPARE` / `PREPARE BUY` / `WAIT` must be AMBER.
- `SHADOW MODE` must be AMBER/GOLD.
- `CONNECTED` / healthy checks must be GREEN.
- `LOCKED` / pending should not look like success.
- Errors / unsafe / hard blocked states must be RED.

Do not show contradictory colours.

## Today's Plan target

Match `01-plan-dashboard-approved.jpg`:

- Compact GoldMeta header
- XAUUSD + LIVE + current price/price change
- Strong decision card readable in ~2 seconds
- Green PLAN READY / BUY READY when genuinely ready
- Amber PREPARE / WAIT when not yet ready
- Compact chart/market area using real existing chart/data only
- VAH / POC / VAL / support / resistance where real values already exist
- Compact trade plan summary with icons for Entry, Stop, TP targets and R:R
- Values visually stronger than labels
- No huge type or excessive whitespace

## Broker target

Match `02-broker-approved.jpg`:

The normal connected state should focus on one clean Pepperstone cTrader account card, not the old permanent broker-selection dashboard.

Primary hierarchy:

- Broker
- Pepperstone cTrader
- Connected state
- LIVE/Demo account type
- masked account
- currency
- quote status

Then a compact Connection Health section:

- OAuth
- Live Quotes
- Token
- Worker
- selected account
- live execution lock

Then four compact actions:

- Reconnect
- Switch Account
- Permissions / Risk
- Account Details

Only reveal account/broker switching controls when the user asks to switch/manage them.

## AutoTrade target

Match `03-autotrade-approved.jpg`:

Main screen must read as a premium control centre, not the old Demo/Live-tab form.

Top status area:

- AutoTrade Control
- SHADOW MODE when applicable
- Account
- AutoTrade ON/OFF
- Live Orders LOCKED/allowed
- Quotes LIVE/waiting

Then:

- Readiness checklist
- 3-step How It Works: Plan Found → Risk Checked → Execution Decision
- Control cards: Shadow Mode, Live AutoTrade, Emergency Stop, Daily Limits
- Compact Risk Summary

Important states must be visible immediately without reading paragraphs.

## Functional rule

Never fake status/data just to match a screenshot. The screenshot controls hierarchy and appearance; displayed values/statuses must come from real GoldMeta state.

Do not change trading algorithms, cTrader OAuth behaviour, backend decision logic or risk logic merely to achieve visual parity.

## Completion threshold

If a user who knows the previous GoldMeta UI opens Plan, Broker or AutoTrade and the result only looks 5–10% different, the redesign is **not complete**.

The deployed screens should clearly resemble these approved references in structure, density, hierarchy and visual language.
