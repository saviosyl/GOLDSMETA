# Mobile Plan V2 — Before / After

## Goal

Make the GoldMeta Plan page feel like a professional daily trading assistant on a phone. The user must understand the current situation within five seconds without scrolling.

## Before (attached-style / Plan V1)

- Repeated NO VALID PLAN messaging:
  - “Today’s Intraday Plan”
  - WAIT — NO VALID PLAN badge
  - WAIT — NO VALID PLAN heading
  - NO VALID INTRADAY PLAN heading
  - “No tradeable direction yet”
  - “Complete trade levels unavailable”
- Large “Current Stage” card with red ✕ marks for ordinary waiting
- Chip-style market strip without “Market bias:” labelling
- Research behind a single “View research” toggle
- Tall per-level cards (`moderate · 1 evidence · held`)
- Plan fold could still show PREPARE / trigger / first target after NO VALID PLAN
- Refresh and Explain scattered; no sticky mobile action bar

## After (Plan V2)

| Concern | Change |
| --- | --- |
| No-valid messaging | One primary **WAIT — NO VALID PLAN** + one supporting sentence + one plain reason |
| Contradictions | When `geometryValid=false` / `NO_VALID_PLAN` / C·NO_PLAN: hide PREPARE, triggers, targets, BUY/SELL styling, tradeable scenarios |
| Above the fold | Sticky market bar + primary card + stage rail + nearest S/R (or Entry/Stop/TP1/TP2 when valid) + action bar |
| Bias | `Market bias: Bullish` + “Bias is market context, not an entry signal.” |
| Stages | Compact CONTEXT → ENTRY → 5M CONFIRM → MANAGE; amber = waiting; red only for genuine failure |
| Next update | Informational `Next 15M plan check` / `Next 5M confirmation check` countdown |
| Secondary | MARKET CONTEXT / RESEARCH / ADVANCED DIAGNOSTICS (collapsed by default for advanced) |
| Levels | Compact ladder rows; plain language on expand |
| Actions | Sticky Refresh · Notify me · Explain (or Open Risk Planner when valid) |

## Screenshot matrix

Mobile (390×844) and desktop (1440×900) for each state:

| State | Mobile | Desktop |
| --- | --- | --- |
| BUY | `mobile-buy.png` | `desktop-buy.png` |
| SELL | `mobile-sell.png` | `desktop-sell.png` |
| WAIT | `mobile-wait.png` | `desktop-wait.png` |
| NO VALID PLAN | `mobile-no-valid.png` | `desktop-no-valid.png` |
| NO TRADE | `mobile-no-trade.png` | `desktop-no-trade.png` |

Also captured at 375×812, 430×932, 768×1024, 1024×768.

## Verification notes

- No horizontal overflow on tested viewports
- No duplicated NO VALID PLAN copy in the primary card
- No NO VALID + PREPARE contradiction in the primary card
- No red failure icon for ordinary waiting stages
- Raw geometry codes only under ADVANCED DIAGNOSTICS
- AutoTrade remains OFF; no order submission UI
