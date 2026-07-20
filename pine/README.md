# GoldMeta Pine Script Bridge

`GoldMetaBridge.pine` is the TradingView-side bridge for GoldMeta. It emits structured JSON alerts for XAUUSD bars and includes only data the script can calculate directly.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## What the script sends

- `schemaVersion: "1.0"`
- `source: "tradingview"`
- Dynamic OHLCV from the chart bar
- Confirmed-bar status
- UTC-hour session heuristic: `ASIA`, `LONDON`, `OVERLAP`, `NEWYORK`, or `UNKNOWN`
- Basic confirmed swing high/low placeholders
- ATR and optional ATR bands
- Higher-timeframe diagnostic close/SMA bias using `request.security(..., lookahead=barmerge.lookahead_off)`
- `metadata.scriptVersion: "1.0.0"`

The script does **not** calculate proprietary volume profile, TPO/market profile, or paid Trend Meter values. Those fields are emitted as `null` or empty arrays and must be populated by separate licensed alerts or backend adapters.

## Add the script to TradingView

1. Open TradingView and select an XAUUSD chart.
2. Open **Pine Editor**.
3. Paste the contents of `pine/GoldMetaBridge.pine`.
4. Click **Save**.
5. Click **Add to chart**.
6. Confirm the status table shows `Symbol OK = YES`.

If you use a broker symbol such as `OANDA:XAUUSD`, the script should pass the XAUUSD check. If the current chart is not XAUUSD, the script shows a red warning label and sends the actual chart symbol so the backend can reject it safely.

## Create the TradingView alert

1. Click **Alerts**.
2. Choose the GoldMeta Bridge indicator.
3. Select **Any alert() function call**.
4. Set the webhook URL:

   ```text
   https://<region>-<firebase-project-id>.cloudfunctions.net/api/webhooks/tradingview/<webhookId>
   ```

5. If TradingView shows a message box, use:

   ```text
   {{alert_message}}
   ```

6. Set alert frequency to match the script behavior. Confirmed-bar mode is ON by default, so once per bar close is expected.
7. Save the alert.

The script calls `alert(alertMessage, ...)` directly. The webhook body should therefore be the generated JSON payload, not a manually typed JSON template.

## Settings

### Symbol

- **Expected symbol** defaults to `XAUUSD`.
- GoldMeta MVP is XAUUSD-only.

### Timeframes

- **Diagnostic HTF** defaults to `60`.
- HTF values use `lookahead_off` to avoid future leakage.

### Alerts

- **Call alert() from script** enables or disables live `alert()` calls.
- **Confirmed-bar mode** defaults to ON and gates alerts with `barstate.isconfirmed`.
- **Test-alert mode** sends one `TEST` event on a realtime bar while enabled.
- **Optional payload secret** is only for deployments that validate a payload-level secret. Prefer a secure opaque webhook URL plus backend-side secret handling.

### Levels (diagnostic)

- Session high/low, swing placeholders, and optional ATR bands can be plotted.
- These are diagnostics, not trade recommendations.

### Status

- The status table shows symbol status, confirmed mode, last close, and current heuristic session.
- Diagnostic mode adds pivot markers.

## Proprietary indicator merge notes

GoldMeta is designed to merge multiple alert sources on the backend:

1. This Pine bridge sends public chart-derived OHLCV and diagnostics.
2. Proprietary volume profile/TPO/Trend Meter scripts send their own licensed alert payloads.
3. The backend validates each source, deduplicates events, and merges compatible events by symbol/timeframe/bar time.
4. If proprietary inputs are missing, the decision engine must treat them as missing data and lower data quality or return `WAIT` according to hard guards.

Do not copy protected Pine code into this bridge unless your license allows it. Do not estimate proprietary values just to fill a field.

## Example payload

See `pine/alert-payload-example.json`.

Confidence shown later by the GoldMeta backend means setup quality and input completeness. Confidence is **not** a win probability.
