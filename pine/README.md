# GoldMeta Pine Script Bridge

`GoldMetaBridge.pine` (script version **3.0.0**, payload `schemaVersion` **1.1**) is the single canonical TradingView → GoldMeta webhook bridge for **XAUUSD** intraday planning.

> Analysis only. Manual trading only. AutoTrade remains OFF. Not a profit guarantee. Not designed or marketed for minors.

The backend remains backward-compatible with Bridge **2.1.0** / schema **1.0** during rollout. Do not put email, password, UID, or account tokens in this script. Per-user setup is limited to webhook URL / optional payload secret / Alert Role / symbol when supported.

## Timeframe hierarchy

| Timeframe | Role | Who uses it |
| --- | --- | --- |
| **4H** (`240`) | Wider market context | Embedded in `PLAN_15M` via `request.security` — never triggers entry |
| **1H** (`60`) | Session direction | Embedded in `PLAN_15M` |
| **15M** (`15`) | Primary intraday plan | `Alert Role = PLAN_15M` on a 15m chart |
| **5M** (`5`) | Entry confirmation / plan status | `Alert Role = CONFIRM_5M` on a 5m chart |
| **1M** (`1`) | Price + freshness only | Optional `Alert Role = QUOTE_1M` on a 1m chart |

All HTF values use `request.security(..., lookahead=barmerge.lookahead_off)`. Confirmed bars only for plan/confirm alerts.

## Alert roles (one script)

| Alert Role | Chart | Emits when | Backend effect |
| --- | --- | --- | --- |
| **PLAN_15M** | 15m | Confirmed 15m close | Create / replace stable session plan |
| **CONFIRM_5M** | 5m | Meaningful confirmation **state change** only | Update matching plan status — never direction/entry/stop/TP |
| **QUOTE_1M** | 1m | Confirmed 1m close | Price, distances, freshness only — `PLAN UNCHANGED` |

Deterministic IDs include symbol, timeframe, confirmed close timestamp, and alert role. `planSourceKey` ties confirm/quote events to the latest confirmed 15m plan source.

## Payload highlights (schema 1.1)

- `schemaVersion: "1.1"`, `metadata.scriptVersion: "3.0.0"`
- `metadata.alertRole`, `metadata.planSourceKey`, `metadata.confirmationState`
- `metadata.fourHourContext` on plan payloads
- Explicit nulls / availability flags — never fabricate POC/VAH/VAL/volume/spread/TPO
- Legacy 2.1.0 `STRATEGY` / `QUOTE` payloads with `schemaVersion: "1.0"` remain accepted

See `docs/GOLD_META_PINE3_STABLE_PLAN.md` for the full contract and plan lifecycle.

## Recommended setup (three alerts)

### 1) PLAN_15M (required)

1. XAUUSD **15-minute** chart → paste / update `pine/GoldMetaBridge.pine` → Add to chart.
2. Inputs → **Alert Role = PLAN_15M**. Status table should show version **3.0.0**, Role `PLAN_15M`, Chart TF OK.
3. Create alert → Condition **GoldMeta Bridge** → **Any alert() function call**.
4. Message: `{{alert_message}}`. Webhook URL = your GoldMeta webhook. Once Per Bar Close / confirmed-bar ON.

### 2) CONFIRM_5M (required for entry confirmation UI)

1. Separate XAUUSD **5-minute** chart with the **same** script.
2. Inputs → **Alert Role = CONFIRM_5M**.
3. Create alert the same way (Any alert() function call + `{{alert_message}}` + same webhook URL).

### 3) QUOTE_1M (optional)

1. XAUUSD **1-minute** chart, **Alert Role = QUOTE_1M**.
2. Same alert pattern. Quote never replaces plan levels.

## Safe replacement of an old 2.1.0 alert

1. Deploy backend that accepts schema **1.0** and **1.1** (this release).
2. Add the new 3.0.0 script + create the new PLAN_15M (and CONFIRM_5M) alerts.
3. Confirm GoldMeta receives `scriptVersion 3.0.0` / `alertRole PLAN_15M`.
4. Only then pause or delete the old 2.1.0 STRATEGY alert.
5. Do **not** auto-modify live TradingView alerts from the app.

## Proprietary / unavailable

| Field family | Status |
| --- | --- |
| Session POC/VAH/VAL (`gm_svp_v1`) | GoldMeta-derived equivalent; null if incomplete |
| Trend Meter style meter | Unavailable — replaced by `gm_trend_v1` |
| TPO / market profile | Unavailable (`null` / `UNKNOWN`) |

Full methodology: `docs/INDICATOR_METHODOLOGY.md`. Alert investigation: `docs/TRADINGVIEW_ALERT_INVESTIGATION.md`.
