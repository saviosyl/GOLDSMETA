# ACTIVE_DEMO opportunity engine

Pepperstone **Demo only**. Live hard locks unchanged.

## Old problem

Qualified setups were armed, then cancelled when a later session-plan refresh
reported `NO_VALID_PLAN` — even though the original thesis (direction, geometry,
SL/TP, RR, score) had already passed.

## New armed lifecycle

1. Arm on qualified A+/A setup with independent `expiresAt` (default **3 × 5M = 15m**).
2. `NO_VALID_PLAN` / `NO_TRADE` → **`PLAN_REFRESH_UNAVAILABLE`** — keep waiting.
3. Invalidate only on: stop breach, hard plan INVALIDATED/EXPIRED, opposite
   meaningful confirmation, opposite strong setup, armed-window expiry,
   emergency stop, pause/off, authority lost.

## Tiers (setup score ≠ win probability)

| Tier | Score | Confirmation |
|------|------:|--------------|
| A+ | ≥ 90 + structural reason tokens | Fast confirm if decision already has meaningful directional confirmation; else wait ≤15m |
| A | 80–89 | Wait for directional 5M confirmation within 15m |

## Accepted confirmation classifications

Documented via `resolveAuthoritativeConfirmation` +
`ACCEPTED_BUY_CONFIRMATIONS` / `ACCEPTED_SELL_CONFIRMATIONS` in
`demoOpportunityEngine.ts`.

Neutral / pending (`OUTSIDE_ZONE`, `APPROACHING_ZONE`, …) → **keep waiting**.
Opposite meaningful confirmation → **invalidate**.

## Asia Demo experiment

London / NewYork / Overlap: normal (classic `allowedSessions`).
Asia: allowed for A+/A with **0.50×** fixed Demo risk. Session recorded on journal.

## Risk multipliers (sizing only — never move SL)

| | London/NY/Overlap | Asia |
|--|--:|--:|
| A+ | 1.00 | 0.50 |
| A | 0.75 | 0.50 |

## Mode

`DEMO_OPPORTUNITY_MODE=ACTIVE_DEMO` (default) or `STRICT` (legacy plan-kill behaviour).

## Next Candle Edge

Remains **SHADOW only** in this PR — not wired to Demo execution.

## Live hard locks

`isCTraderLiveEnabled()` / `isBrokerExecutionEnabled()` remain false.
No real-money broker order path is opened by this engine.
