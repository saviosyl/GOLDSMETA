# ACTIVE_DEMO opportunity engine

Pepperstone **Demo only**. Live hard locks unchanged.

## Old problem

Qualified setups were armed, then cancelled when a later session-plan refresh
reported `NO_VALID_PLAN` — even though the original thesis (direction, geometry,
SL/TP, RR, score) had already passed.

## New armed lifecycle

1. Arm on qualified A+/A setup with independent `expiresAt` (default **3 × 5M = 15m**).
2. `NO_VALID_PLAN` → **`PLAN_REFRESH_UNAVAILABLE`** — keep waiting.
3. `NO_TRADE` → **hard invalidate** (GoldMeta non-actionable: mismatch / chart-role).
4. `INVALIDATED` / `EXPIRED` → hard invalidate.
5. Other real invalidators: stop breach (bid for BUY / ask for SELL), opposite
   meaningful confirmation, opposite strong A/A+ setup, armed-window expiry,
   emergency stop, pause/off, autonomous authority lost.

## Tiers (setup score ≠ win probability / ≠ confidence)

| Tier | Score | Confirmation |
|------|------:|--------------|
| A+ | ≥ configured A+ (default 90) + structural + **directional** decision evidence | Fast confirm when completed decision already has direction-aware support; else wait ≤15m |
| A | ≥ configured A (default 80) and &lt; A+ | Wait for directional 5M confirmation within 15m |
| BELOW | &lt; A | **Hard reject** `TIER_BELOW_A` — no arm / replace / submit |

Confidence alone must not promote a BELOW setupScore into the order pipeline.

## Session-plan semantics

| State | Armed thesis behaviour |
|-------|------------------------|
| `NO_VALID_PLAN` | Soft — `PLAN_REFRESH_UNAVAILABLE`, keep ARMED until own expiry |
| `NO_TRADE` | Hard — invalidate / block (non-actionable) |
| `INVALIDATED` / `EXPIRED` | Hard — invalidate |

## Asia Demo experiment

London / NewYork / Overlap: normal (classic `allowedSessions`).
Asia: allowed for A+/A with **0.50×** fixed Demo risk. Session recorded on journal.

## Risk multipliers (sizing only — never move SL)

| | London/NY/Overlap | Asia |
|--|--:|--:|
| A+ | 1.00 | 0.50 |
| A | 0.75 | 0.50 |
| BELOW | 0 (fail closed) | 0 |

ACTIVE_DEMO never falls back via `riskMult \|\| 1`. Invalid multiplier → reject.

## Runtime config (env)

| Variable | Default | Bounds |
|----------|---------|--------|
| `DEMO_OPPORTUNITY_MODE` | `ACTIVE_DEMO` | `ACTIVE_DEMO` \| `STRICT` |
| `DEMO_ARMED_CONFIRMATION_BARS_5M` | `3` | 1–12 |
| `DEMO_A_PLUS_MIN_SCORE` | `90` | 50–100; must be &gt; A min |
| `DEMO_A_MIN_SCORE` | `80` | 50–100; must be &lt; A+ min |
| `DEMO_ASIA_EXPERIMENTAL_ENABLED` | `true` | bool |
| `DEMO_RISK_MULT_A_PLUS_MAJOR` | `1` | &gt;0 and ≤1 |
| `DEMO_RISK_MULT_A_MAJOR` | `0.75` | &gt;0 and ≤1 |
| `DEMO_RISK_MULT_ASIA` | `0.5` | &gt;0 and ≤1 |

Invalid values fail closed to defaults. Multiplier &gt;1 not allowed in this PR.

## Next Candle Edge

Remains **SHADOW only** — not wired to Demo execution.

## Live hard locks

`isCTraderLiveEnabled()` / `isBrokerExecutionEnabled()` remain false.
No real-money broker order path is opened by this engine.
