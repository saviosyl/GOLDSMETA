# GoldMeta Bridge 3.0.0 + Stable Intraday Plan

## Pine payload schema

| Field | 2.1.0 | 3.0.0 |
| --- | --- | --- |
| `schemaVersion` | `"1.0"` | `"1.0"` or `"1.1"` |
| `metadata.scriptVersion` | `2.1.0` | `3.0.0` |
| `metadata.alertKind` | `STRATEGY` / `QUOTE` | same (compat) |
| `metadata.alertRole` | absent | `PLAN_15M` / `CONFIRM_5M` / `QUOTE_1M` |
| `metadata.planSourceKey` | absent | deterministic plan key |
| `metadata.confirmationState` | absent | CONFIRM_5M only |
| `eventId` | symbol\|tf\|barClose\|kind | includes alertRole |

Backend accepts both 2.1.0 (`alertKind` only) and 3.0.0 (`alertRole` + optional `schemaVersion` 1.1).

## Alert roles

1. **PLAN_15M** — confirmed 15M bar; includes 4H context, 1H direction, 15M structure. Creates/replaces stable plan.
2. **CONFIRM_5M** — confirmed 5M bar; meaningful confirmation state changes only. Updates plan status; never replaces entry/stop/TP.
3. **QUOTE_1M** — OHLC/freshness only. Never changes plan direction or levels.

## Stable plan lifecycle

States: `NO_VALID_PLAN` → `BUILDING` → `WAITING_FOR_ENTRY_ZONE` → `ARMED` → `CONFIRMED` → `IN_PROGRESS` → `TP1_REACHED` / `TP2_REACHED` / `INVALIDATED` / `EXPIRED` / `NO_TRADE`.

Replace plan only on new PLAN_15M, session change, material HTF change, expiry, or invalidation with a new complete setup.
Quote updates mark `PLAN UNCHANGED` and refresh price/distances/freshness only.

## Backend consumers

`GET /v1/decisions/latest` returns:

- `sessionPlan` — full stable plan record (`users/{uid}/sessionPlans/...`)
- `stablePlan` — compact fields for web (planId, lifecycleState, planStabilityLabel, direction, entry/stop/TP, confirmationState, planQuality, quickTarget, distances, safety)

Plan quality: `A` | `B` | `C` | `NO_PLAN` with reasons.
Quick-target day-trade TP1: nearest structural level with room + min R:R validation.

## Safety

Analysis only · Manual trading · AutoTrade OFF · Demo/Live submission OFF · MISMATCH = NO TRADE.
