# GoldMeta Pine Script Bridge

`GoldMetaBridge.pine` (script version **2.1.0**) is the TradingView-side bridge for GoldMeta intraday day-trade intelligence on **XAUUSD** (~30 minutes to several hours). It emits structured JSON alerts using closed-candle-only processing and explicit **STRATEGY** vs **QUOTE** separation.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision. AutoTrade remains OFF — analysis only.

## Intraday timeframe roles

| Timeframe | Role | In payload |
| --- | --- | --- |
| **1 hour** (`60`) | Main direction bias | `trend.components` → `gm_direction_1h` |
| **15 minutes** (`15`) | Structure and setup (chart TF) | Chart bar OHLC, VP, confirmation, structure levels |
| **5 minutes** (`5`) | Entry confirmation | `trend.components` → `gm_entry_5m` |
| **1 minute** (`1`) | Optional price/freshness only | Lightweight `QUOTE` alerts — never reverses day-trade plan |

All higher-timeframe values use `request.security(..., lookahead=barmerge.lookahead_off)`.

## Alert kinds (STRATEGY vs QUOTE)

| Kind | When | `metadata.alertKind` | Payload |
| --- | --- | --- | --- |
| **STRATEGY** | Confirmed **15m** bar close | `STRATEGY` | Full structure: OHLC, ATR, VWAP, EMA 21/50/200, RSI, ADX, volume/relative volume, POC/VAH/VAL (developing), session & day levels, swings, opening range, S/R, breakout/rejection/retest states, confirmation candle, timestamps |
| **QUOTE** | Optional **1m** bar close (setting ON) | `QUOTE` | OHLC + metadata only (`quoteOnly`, `neverReversesStrategy`). No trend/levels — backend keeps last valid STRATEGY for structure |

Deterministic `eventId`: `SYMBOL|timeframe|barCloseMs|STRATEGY|QUOTE`.

## What the STRATEGY alert sends

- `schemaVersion: "1.0"`, `source: "tradingview"`
- Dynamic OHLCV from the confirmed chart bar
- `barTime` = `time_close`, `sentAt` = `timenow`
- Confirmed-bar gating via `barstate.isconfirmed`
- Alert frequency `alert.freq_once_per_bar_close` when confirmed-bar mode is ON
- UTC session heuristic: `ASIA`, `LONDON`, `OVERLAP`, `NEWYORK`, or `UNKNOWN`
- **gm_svp_v1** session volume profile → POC / VAH / VAL (developing until session end)
- **gm_trend_v1** EMA-stack trend → 1h direction + 15m structure + 5m entry (`lookahead_off`)
- **gm_candle_v1** confirmation classification → `REJECTION` | `BREAKOUT` | `RETEST` | `CONTINUATION` | `NONE`
- `optionalIndicators`: ATR, VWAP, EMAs, RSI, ADX, relative volume, day levels, opening range, structure states, support/resistance arrays
- `metadata.scriptVersion`, `alertKind`, methodology tags, and `partial` when VP cannot be computed

See `docs/INDICATOR_METHODOLOGY.md` for formulas, session boundaries, bin size, and value-area rules.

### Proprietary / unavailable

| Field family | Status |
| --- | --- |
| Session POC/VAH/VAL (`gm_svp_v1`) | Equivalent internal calculation |
| Trend Meter style meter | **Unavailable** — replaced by `gm_trend_v1` EMA stack |
| TPO / market profile (`marketProfile.*`) | **Unavailable** (`null` / `UNKNOWN`) |

If a required value cannot be calculated reliably (e.g. `UNKNOWN` session or profile overflow), levels are `null` and `metadata.partial = true`. The backend treats that as incomplete and defaults to **WAIT**.

## Recommended chart

- Symbol: **XAUUSD** (broker prefixes such as `OANDA:XAUUSD` are accepted)
- Timeframe: **15** (structure/setup)
- Confirmed-bar mode: ON for production
- **Enable 1m quote-only alerts**: OFF by default; turn ON only if you want fresher live prices without replacing structure

## Add the script to TradingView

1. Open TradingView and select an XAUUSD **15m** chart.
2. Open **Pine Editor**.
3. Paste the contents of `pine/GoldMetaBridge.pine`.
4. Click **Save**, then **Add to chart**.
5. Confirm the status table shows version **2.1.0**, `Symbol OK = YES`, `Chart TF = OK`, and `Webhook = STRATEGY` (or `STRAT+QUOTE`).

## Create the TradingView alert (desktop Supercharts)

**Verified fact:** TradingView always offers technical alerts on `plot()` series. Those look like “GoldMeta Session High / POC / …”. They are **not** webhook JSON alerts.

GoldMeta webhooks require:

1. Desktop Supercharts (not mobile-first setup).
2. Toolbar **Alert** → **Create alert** (not legend / right-click on a level).
3. Condition → **GoldMeta Bridge** → **Any alert() function call**.
4. Webhook URL + Message `{{alert_message}}`.

Full investigation: `docs/TRADINGVIEW_ALERT_INVESTIGATION.md`.

### Exact alert setup

| Field | Value |
| --- | --- |
| Condition (1st) | `GoldMeta Bridge` |
| Condition (2nd) | **Any alert() function call** |
| Webhook URL | `https://<region>-<project-id>.cloudfunctions.net/api/webhooks/tradingview/<webhookId>` |
| Message | `{{alert_message}}` |
| Frequency | Controlled by Pine (`once per bar close` when confirmed-bar mode ON) |

One alert catches both STRATEGY and optional QUOTE `alert()` calls from the same script.

## Settings

- **Direction / Structure / Entry / Quote TF** — defaults `60` / `15` / `5` / `1`.
- **Enable 1m quote-only alerts** — default OFF.
- **Confirmed-bar mode** — default ON.
- **Test-alert mode** — sends one `TEST` STRATEGY event while enabled.
- Diagnostic levels use `line.new` (not `plot`) so Create Alert is not cluttered with plot series.
- Optional payload secret only when the backend connection uses one.

## Confidence note

Confidence shown later by the GoldMeta backend means setup quality and input completeness. Confidence is **not** a win probability.

## Example payloads

| File | Description |
| --- | --- |
| `docs/examples/tradingview-intraday-strategy-payload.json` | Full STRATEGY alert (canonical) |
| `docs/examples/tradingview-intraday-quote-payload.json` | Lightweight QUOTE alert |
| `pine/alert-payload-example.json` | Legacy path — mirrors STRATEGY example |

Validated by `backend/tests/unit/tradingview/intradayPayload.test.ts`.

## Changelog

- **2.1.0** — Issue #50 intraday day-trade upgrade: MTF roles (1h/15m/5m/1m), full indicator payload, STRATEGY vs QUOTE alert separation, deterministic event IDs, VWAP/RSI/ADX/EMA200/relative volume/day levels/opening range/structure states, docs and validation tests.
- **2.0.5** — VP overflow guards; line-based diagnostic levels.
- **2.0.4** — Investigation: missing “Any alert() function call” was TradingView’s plot/technical alert path, not a missing `alert()`. Draw levels with `line.new` / labels instead of `plot` / `plotshape` so Condition is not filled with Session High / POC / …; status table shows Webhook row; docs updated.
- **2.0.3** — Remove `barstate.isrealtime` gate around `alert()`; clarify desktop alert setup.
- **2.0.2** — Fix RE10045 array bounds: recompute start/end indices after left expansion; hard bounds checks; overflow instead of out-of-range writes.
- **2.0.1** — Fix Pine v6 compile errors: volume-profile helpers no longer reassign global scalars; they return tuples / mutate arrays by reference.
- **2.0.0** — Initial gm_svp_v1 / gm_trend_v1 / gm_candle_v1 production bridge.
