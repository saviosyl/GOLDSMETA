# GoldMeta Pine Script Bridge

`GoldMetaBridge.pine` (script version **2.0.4+**) is the TradingView-side bridge for GoldMeta. It emits structured JSON alerts for **XAUUSD** bars using closed-candle-only processing.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## What the script sends

- `schemaVersion: "1.0"`
- `source: "tradingview"`
- Dynamic OHLCV from the confirmed chart bar
- `barTime` = `time_close`, `sentAt` = `timenow`
- Confirmed-bar gating via `barstate.isconfirmed`
- Alert frequency `alert.freq_once_per_bar_close` when confirmed-bar mode is ON
- UTC session heuristic: `ASIA`, `LONDON`, `OVERLAP`, `NEWYORK`, or `UNKNOWN`
- **gm_svp_v1** session volume profile → `POC` / `VAH` / `VAL` (GoldMeta-derived equivalent, not proprietary VP)
- **gm_trend_v1** EMA-stack trend → direction, strength 0–100, MTF components (chart + HTF 60/240)
- **gm_candle_v1** confirmation classification → `REJECTION` | `BREAKOUT` | `RETEST` | `CONTINUATION` | `NONE`
- ATR diagnostics in `optionalIndicators.atr`
- `metadata.scriptVersion`, methodology tags, and `partial` when VP cannot be computed

See `docs/INDICATOR_METHODOLOGY.md` for exact formulas, session boundaries, bin size, and value-area rules.

### Proprietary / unavailable

| Field family | Status |
| --- | --- |
| Session POC/VAH/VAL (`gm_svp_v1`) | Equivalent internal calculation |
| Trend Meter style meter | **Unavailable** — replaced by `gm_trend_v1` EMA stack |
| TPO / market profile (`marketProfile.*`) | **Unavailable** (`null` / `UNKNOWN`) |
| RSI / MACD as first-class decision inputs | **Not sent** — backend webhook schema / live pipeline does not score them |

If a required value cannot be calculated reliably (e.g. `UNKNOWN` session or profile overflow), levels are `null` and `metadata.partial = true`. The backend treats that as incomplete and defaults to **WAIT**.

## Recommended chart

- Symbol: **XAUUSD** (broker prefixes such as `OANDA:XAUUSD` are accepted)
- Timeframe: **15**

## Add the script to TradingView

1. Open TradingView and select an XAUUSD **15m** chart.
2. Open **Pine Editor**.
3. Paste the contents of `pine/GoldMetaBridge.pine`.
4. Click **Save**, then **Add to chart**.
5. Confirm the status table shows version **2.0.4+**, `Symbol OK = YES`, and `Webhook = Any alert()`.

## Create the TradingView alert (desktop Supercharts)

**Verified fact:** TradingView always offers technical alerts on `plot()` series. Those look like “GoldMeta Session High / POC / …”. They are **not** webhook JSON alerts.

GoldMeta webhooks require:

1. Desktop Supercharts (not mobile-first setup).
2. Toolbar **Alert** → **Create alert** (not legend / right-click on a level).
3. Condition → **GoldMeta Bridge** → **Any alert() function call**.
4. Webhook URL + Message `{{alert_message}}`.

Full investigation: `docs/TRADINGVIEW_ALERT_INVESTIGATION.md`.

## Settings

- **Expected symbol** defaults to `XAUUSD`.
- **Trend HTF 1 / 2** default to `60` / `240` with `lookahead_off`.
- **Confirmed-bar mode** defaults ON.
- **Test-alert mode** sends one `TEST` event while enabled.
- Diagnostic levels are drawn with `line.new` (not `plot`) so Create Alert is not cluttered with plot series.
- Optional payload secret only when the backend connection uses one.

## Confidence note

Confidence shown later by the GoldMeta backend means setup quality and input completeness. Confidence is **not** a win probability.

## Example payload

See `pine/alert-payload-example.json`.

## Changelog

- **2.0.4** — Investigation: missing “Any alert() function call” was TradingView’s plot/technical alert path, not a missing `alert()`. Draw levels with `line.new` / labels instead of `plot` / `plotshape` so Condition is not filled with Session High / POC / …; status table shows Webhook row; docs updated.
- **2.0.3** — Remove `barstate.isrealtime` gate around `alert()`; clarify desktop alert setup.
- **2.0.2** — Fix RE10045 array bounds: recompute start/end indices after left expansion; hard bounds checks; overflow instead of out-of-range writes.
- **2.0.1** — Fix Pine v6 compile errors: volume-profile helpers no longer reassign global scalars; they return tuples / mutate arrays by reference.
- **2.0.0** — Initial gm_svp_v1 / gm_trend_v1 / gm_candle_v1 production bridge.
