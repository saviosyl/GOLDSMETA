# Phase 2 Report — Indicator Bridge & Decision Completeness

## Verdict

Controlled backend tests pass (74 backend + 33 web). **Do not deploy live BUY/SELL until** the updated Pine script is installed on the XAUUSD 15m chart, a fresh complete alert is verified end-to-end in production, and STALE/duplicate/partial guards are re-checked on the live webhook.

## Volume-profile method (`gm_svp_v1`)

- UTC sessions: ASIA `[0,7)`, LONDON `[7,13)`, OVERLAP `[13,17)`, NEWYORK `[17,22)`; UNKNOWN `[22,24)` → null levels
- Reset on session name change
- `binSize = max(mintick×10, ATR14/20)`; fixed per session
- Closed bars only; volume shared equally across traded bins
- POC = max-volume bin midpoint; VA grows to **70%** total volume
- Equivalent internal — **not** proprietary VP / TradingView built-in VP

## Trend method (`gm_trend_v1`)

- Chart EMA21/EMA50 stack + HTF 60/240 via `request.security(..., lookahead_off)`
- Component: BULLISH/BEARISH/NEUTRAL + strength 0–100
- Aggregate signed strength → direction + strength
- Equivalent internal — **not** proprietary Trend Meter

## Candle method (`gm_candle_v1`)

- Confirmed bar only; classification priority: REJECTION → BREAKOUT → RETEST → CONTINUATION → NONE
- ENGULFING sets `candleType`

## Pine limitations

- Cannot read proprietary indicator series directly
- TPO/`marketProfile` fields remain unavailable (`null`)
- RSI/EMA/MACD not first-class on live webhook scoring path (EMA used only inside trend model)
- Session VP may be null on UNKNOWN hours or bin overflow (`metadata.partial=true`)
- Tick volume ≠ exchange volume depending on broker feed

## Backend fields changed (new decisions)

Added/persisted: `timeframe`, `barTime`, `ohlcv`, `marketStructure` `{trend, trendStrength, poc, vah, val, confirmation*}`  
Versions: `BACKEND_VERSION=1.1.0-phase2`, `RULE_CONFIG_VERSION=rules-1.1.0`  
Legacy records without `timeframe` still render History as `—` (no Firestore rewrite)

## Safety (additive)

Preserved: `STALE_DATA`, duplicate protection, RR floor, provisional lock, HTF contradiction  
Added: `INCOMPLETE_DATA`, `MISSING_VOLUME_PROFILE`, `MISSING_TREND`, `MISSING_CONFIRMATION`, `CONFLICTING_TREND`, `LOW_CONFIDENCE`, `POOR_RISK_REWARD`, `INSUFFICIENT_EVIDENCE` (≥2 indicator families for BUY/SELL)  
`AI_ENABLED` default false; broker execution unchanged; `ios/` untouched

## Test results

- Backend: **74 passed**
- Web: **33 passed**
- Covered: fresh BUY, fresh SELL, neutral WAIT, stale WAIT, partial WAIT, duplicate single decision, malformed 400, timeframe on History API

## Sample outcomes (controlled)

| Case | Decision | Notable codes |
| --- | --- | --- |
| Fresh complete bullish (`strongBuy`) | BUY | GOOD quality; timeframe `15`; marketStructure populated |
| Fresh complete bearish (`strongSell`) | SELL | timeframe `15` |
| Neutral | WAIT | `MISSING_CONFIRMATION` |
| Stale | WAIT | `STALE_DATA` |
| Partial (null VP) | WAIT | `MISSING_VOLUME_PROFILE`, `INCOMPLETE_DATA` |
| Duplicate | one decision | `duplicate: true` on replay |

## Repainting review

- Alerts gated by `barstate.isconfirmed` + `alert.freq_once_per_bar_close`
- HTF via `lookahead_off`
- VP accumulates confirmed bars only
- No future bar references in classification beyond `[1]` (prior closed bar)

## Deployment recommendation

1. Merge this PR into the production branch after review.
2. Deploy **backend** first (schema/guard changes).
3. Update TradingView with `pine/GoldMetaBridge.pine` v2.0.1 on XAUUSD **15m**; recreate alert.
4. Run one controlled LIVE alert; confirm History shows `15m` and POC/VAH/VAL.
5. Only then treat BUY/SELL as production-ready for operator review (still analysis-only; no broker execution).
