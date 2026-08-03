# Issue #50 — Intraday intelligence + compact premium dashboard

## Behaviour changes

- Home dashboard is action-first: current instruction, expected range, scenarios, zones, compact trade plan, and interactive important levels appear above pipeline/score diagnostics.
- Generic `WAIT` is replaced by clearer server-built actions: `BUY NOW`, `BUY ON PULLBACK`, `BUY ABOVE`, `SELL NOW`, `SELL ON REJECTION`, `SELL BELOW`, `RANGE TRADE`, `PREPARE — SETUP FORMING`, `NO TRADE`.
- Backend `GET /v1/decisions/latest` now includes `intradayPlan` with trigger, confirmation, invalidation, probable/stretch ranges, scenarios, zones, reasoned important levels, checklist progress, and freshness diagnostics.
- Important levels are only labelled when structured evidence exists (POC/VAH/VAL, session high/low, plan levels, ATR projection, etc.). No invented reasons.
- TradingView Pine Script upgraded to **2.1.0** for XAUUSD day trades (1h direction / 15m structure / 5m confirm / optional 1m quote-only). Complete strategy alerts are separate from quote-only updates.
- PR #47 behaviour preserved: OHLC-only updates never replace the latest valid complete strategy signal.

## Safety status (unchanged)

- Manual trading / analysis only
- AutoTrade **OFF**
- Demo order submission **OFF**
- Live trading **OFF**
- No broker orders submitted
- Broker/OAuth work paused; deployed cTrader web routing from SHA `7aea262` left intact

## Owner actions still required

1. Review the draft PR and approve before any merge.
2. Paste the updated `pine/GoldMetaBridge.pine` (v2.1.0) into TradingView and recreate/verify the alert using **Any alert() function call** + `{{alert_message}}` (see `pine/README.md` and `docs/TRADINGVIEW_SETUP.md`).
3. Confirm production webhook continues to accept STRATEGY vs QUOTE payloads without erasing complete structure.
4. Explicitly approve any later deploy (this issue must not be deployed without approval).
