# GoldMeta Pine Script Bridge

`GoldMetaBridge.pine` (script version **2.0.0+**) is the TradingView-side bridge for GoldMeta. It emits structured JSON alerts for **XAUUSD** bars using closed-candle-only processing.

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
5. Confirm the status table shows `Symbol OK = YES` and `VP ready` during known sessions.

## Create the TradingView alert

1. Click **Alerts**.
2. Choose the GoldMeta Bridge indicator.
3. Select **Any alert() function call**.
4. Set the webhook URL:

   ```text
   https://<region>-<firebase-project-id>.cloudfunctions.net/api/webhooks/tradingview/<webhookId>
   ```

5. Message box:

   ```text
   {{alert_message}}
   ```

6. Frequency: once per bar close (matches confirmed-bar mode).
7. Save the alert.

## Settings

- **Expected symbol** defaults to `XAUUSD`.
- **Trend HTF 1 / 2** default to `60` / `240` with `lookahead_off`.
- **Confirmed-bar mode** defaults ON.
- **Test-alert mode** sends one `TEST` event while enabled.
- Optional payload secret only when the backend connection uses one.

## Confidence note

Confidence shown later by the GoldMeta backend means setup quality and input completeness. Confidence is **not** a win probability.

## Example payload

See `pine/alert-payload-example.json`.
