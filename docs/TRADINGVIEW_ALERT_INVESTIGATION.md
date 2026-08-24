# TradingView alert investigation — “Any alert() function call”

**Date:** 2026-07-21  
**Scripts tested by user:** GoldMeta Bridge **v2.0.2** and **v2.0.3**  
**Follow-up script:** **v2.0.4** (UX: remove alertable `plot()` series)

## Verdict

| Question | Answer |
| --- | --- |
| Pine Script bug in v2.0.3? | **No.** `alert()` is present and correctly structured for webhook JSON. |
| TradingView platform limitation? | **No hard block** on desktop Supercharts. TV exposes **two alert paths**; plot names are the technical path. |
| Mobile app cause? | **Contributing, not sole cause.** Complex Pine/`alert()` setup is limited on mobile; configure on **desktop Supercharts**. |
| Why user only saw Session High / POC / VAH / VAL? | Those strings are exactly the **`plot()` titles**. That is TradingView’s **technical/plot alert** UI, not the **script `alert()`** UI. |

## What was verified on TradingView Web (latest)

Live checks from this environment against `tradingview.com` (2026-07-21):

1. **Supercharts** loads for `OANDA:XAUUSD` (guest session).
2. Clicking **Create alert** without login shows TradingView’s signup/upsell modal (“Never miss a trade again” / Join for free) — alerts require an account. Artifacts: `docs/artifacts/tv-alert-verify/after-create-alert.png`.
3. Official Help Center [Alerts on alert() function](https://www.tradingview.com/support/solutions/43000597494-alerts-on-alert-function/) states the required steps:
   - Select the **script** in the Condition field
   - Choose **“Any alert() function call”** (the first option)
4. Official Pine FAQ ([Alerts](https://www.tradingview.com/pine-script-docs/faq/alerts/)):
   - Scripts with `alert()` expose **one** Condition option: **Any alert() function call**
   - `alertcondition()` exposes **named** conditions
   - Separately, **any `plot()` / `plotshape()`** can be used for Crossing / Greater Than / etc. (technical alerts)

This environment cannot log into the user’s TradingView account or paste GoldMeta onto their chart. Behavior of “Any alert() function call” is therefore verified against **current TradingView Web UI + official docs**, matched to the user’s reported Condition list (exact `plot()` titles from our script).

## Root cause (exact)

TradingView does **not** put webhook JSON and plot crossings in one flat “GoldMeta alerts” list.

```text
Path A — Script alert (required for GoldMeta webhooks)
  Toolbar → Create alert
  Condition[1] = "GoldMeta Bridge"   ← the indicator itself
  Condition[2] = "Any alert() function call"
  Message      = {{alert_message}}
  Webhook URL  = your GoldMeta URL

Path B — Technical / plot alert (what you were seeing)
  Legend plot → Add alert, or Condition[1]/[2] = a plot series
  Options look like:
    - GoldMeta Session High
    - GoldMeta Session Low
    - GoldMeta POC
    - GoldMeta VAH
    - GoldMeta VAL
  These fire on Crossing / value rules.
  They do NOT execute Pine alert() and do NOT send our dynamic JSON.
```

Seeing only Path B names means the Create Alert dialog was on the **plot/technical** path (or the plot series list), **not** that `alert()` was missing from the script.

## Supported alternative?

| Approach | Works for GoldMeta webhook JSON? |
| --- | --- |
| **Any alert() function call** + Message `{{alert_message}}` | **Yes — required** |
| Plot Crossing / POC / VAH / VAL alerts | **No** — static/technical; no `alert()` payload |
| `alertcondition()` named conditions | **No** for full dynamic JSON (message is largely static / placeholders; cannot build our full schema string) |

There is no supported plot-based substitute for the bridge payload.

## Correct desktop workflow

1. Use **desktop** TradingView **Supercharts** (browser), logged in.
2. Remove old GoldMeta instances. Paste **v2.0.4+**, Save, **Add to chart**.
3. Confirm status table: version **2.0.4+**, `Webhook = Any alert()`.
4. Click the toolbar **Alert** clock → **Create alert** (do **not** right-click a level line / legend series).
5. Condition → **GoldMeta Bridge** → **Any alert() function call**.
6. Webhook URL on; Message exactly:

   ```text
   {{alert_message}}
   ```

7. Create. Webhooks still need a plan that allows webhooks + 2FA per TradingView policy.

## What v2.0.4 changes

v2.0.3 already called `alert()` correctly. Users still selected plot titles because those titles dominated the Condition UI.

**v2.0.4** draws Session High/Low / POC / VAH / VAL with **`line.new`** (and diagnostic pivots with **labels**) instead of **`plot` / `plotshape`**, so Create Alert is no longer filled with “GoldMeta Session High / POC / …”. Webhook setup still requires **Any alert() function call**.

## References

- https://www.tradingview.com/support/solutions/43000597494-alerts-on-alert-function/
- https://www.tradingview.com/pine-script-docs/faq/alerts/
- https://www.tradingview.com/support/solutions/43000763315-getting-started-with-technical-alerts/
- Local captures: `docs/artifacts/tv-alert-verify/`
