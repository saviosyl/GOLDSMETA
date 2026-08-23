# GoldMeta Indicator Methodology (Phase 2)

This document defines the deterministic methods used by `pine/GoldMetaBridge.pine` (script version `2.0.2+`).

**Important distinction**

| Label | Meaning |
| --- | --- |
| Exact proprietary | Values taken from a licensed proprietary indicator alert (not implemented in GoldMetaBridge). |
| Equivalent internal (`gm_*`) | GoldMeta-derived calculation inside the bridge. Deterministic and documented. **Not claimed identical** to any proprietary product unless separately verified. |
| Unavailable | Field left `null` / empty; payload marked partial when the value is required for a trade. |

GoldMetaBridge does **not** invent proprietary Trend Meter, proprietary Volume Profile, or TPO values.

---

## gm_svp_v1 — Session volume profile (equivalent internal)

### Purpose
Produce session `POC`, `VAH`, and `VAL` from closed-bar OHLCV only.

### Session boundaries (UTC hour of bar `time`)
| Session | UTC hours | Reset |
| --- | --- | --- |
| `ASIA` | `[0, 7)` | On session name change |
| `LONDON` | `[7, 13)` | On session name change |
| `OVERLAP` | `[13, 17)` | On session name change |
| `NEWYORK` | `[17, 22)` | On session name change |
| `UNKNOWN` | `[22, 24)` | Profile cleared; **POC/VAH/VAL = null** |

`sessionStart` = first bar `time` of the session.  
`sessionEnd` = current closed bar `time_close` when the alert is emitted.

### Bin size
On each session reset:

```text
binSize = max(syminfo.mintick * 10, ATR(14) / 20)
```

ATR uses the same length as the bridge ATR input (default 14). Bin size is fixed for the life of that session.

### Accumulation (closed bars only)
For each **confirmed** bar in a known session:

1. Map `[low, high]` into bin indices relative to `profileAnchor` (floor-aligned to `binSize`).
2. Expand the bin array left/right as needed (hard cap `MAX_BINS = 300`).
3. Distribute the bar’s `volume` **equally** across every bin the bar trades through.

If the bin cap would be exceeded, the profile is marked overflow and POC/VAH/VAL are emitted as `null` (partial).

### POC
Bin with maximum accumulated volume.  
Price = `profileAnchor + (pocIndex + 0.5) * binSize`.

### Value area (70%)
1. Start at the POC bin.
2. Grow one bin at a time toward the adjacent side with greater volume (ties prefer the upside).
3. Stop when covered volume ≥ **70%** of total session volume.

- `VAL` = bottom edge of the lowest included bin = `profileAnchor + loIndex * binSize`
- `VAH` = top edge of the highest included bin = `profileAnchor + (hiIndex + 1) * binSize`

### Acceptance heuristic
- `ACCEPTANCE` if `close` is inside `[VAL, VAH]`
- `REJECTION` if `close` is outside the value area
- `UNKNOWN` otherwise / when profile not ready

### Payload mapping
- `levels.pocAll` / `vahAll` / `valAll` ← session POC/VAH/VAL when ready
- `sessionVolumeProfile.poc` / `vah` / `val` ← same
- `marketProfile.*` TPO fields remain **unavailable** (`null` / `UNKNOWN`)

### Proprietary difference
This is **not** TradingView’s built-in Visible Range / Session Volume Profile and **not** a third-party VP product. It is a reproducible GoldMeta session histogram.

---

## gm_trend_v1 — EMA stack trend (equivalent internal)

### Inputs (closed-bar series only)
- Chart: `EMA(21)`, `EMA(50)`, `ATR(14)`, `close`
- HTF1 default `60`, HTF2 default `240` via:

```text
request.security(..., lookahead = barmerge.lookahead_off)
```

### Component direction
For each timeframe component:

- `BULLISH` if `close > EMA21 > EMA50`
- `BEARISH` if `close < EMA21 < EMA50`
- else `NEUTRAL`

### Component strength (0–100)
```text
sep = |EMA21 - EMA50|
base = clamp100(sep / ATR * 40)
align = direction == NEUTRAL ? 0 : 35
stretch = clamp100(|close - EMA21| / ATR * 25)
strength = clamp100(base + align + 0.4 * stretch)
```

### Aggregate
```text
signed = average(sign(component) * strength)   // BULLISH=+ , BEARISH=- , NEUTRAL=0
direction = signed >= 15 → BULLISH
          | signed <= -15 → BEARISH
          | else NEUTRAL
strength = |signed| clamped to 0–100
```

### Output fields
- `trend.direction`, `trend.strength`
- `trend.components[]` with `name`, `direction`, `strength`, `sourceTimeframe`

### Proprietary difference
This is **not** a paid Trend Meter clone. It is an EMA-stack multi-timeframe model.

---

## gm_candle_v1 — Confirmation candle classification

Evaluated on the **confirmed** bar only.

### Direction
- `BULLISH` if `close > open`
- `BEARISH` if `close < open`
- else `NEUTRAL`

### `candleType`
- `ENGULFING` when a classic engulfing pattern prints; otherwise omitted/`null`

### `classification` (priority order)
1. `REJECTION` — long opposing wick (≥55% of range), small body (≤35%), wick interacts with VAL (bull) or VAH (bear)
2. `BREAKOUT` — prior close inside/on value side, current close accepts beyond VAH (bull) or VAL (bear)
3. `RETEST` — after acceptance beyond VAH/VAL, price tags the level and closes back on the breakout side
4. `CONTINUATION` — body ≥60% of range aligned with aggregate trend, or engulfing
5. `NONE` — otherwise

### Non-repainting
Classification uses confirmed OHLCV and the session profile state as of that closed bar. Alerts use `barstate.isconfirmed` and `alert.freq_once_per_bar_close`.

---

## Backend completeness & safety (Phase 2)

Every **new** decision stores at least:

- `symbol`, `timeframe`, `barTime`, `generatedAt`
- `ohlcv`, `marketStructure` (`poc`/`vah`/`val`/`trend`/`trendStrength`/confirmation fields)
- `dataQuality`, `decision`/`action`, `reasonCodes`, evidence lists
- `entry` / `stopLoss` / `takeProfits` / `riskReward` when applicable

Legacy Firestore records without `timeframe` remain readable; the History UI shows `—` for missing timeframe (no rewrite).

### Explicit WAIT reason codes (additive; existing guards preserved)
- `STALE_DATA`
- `INCOMPLETE_DATA` / `MISSING_VOLUME_PROFILE` / `MISSING_TREND` / `MISSING_CONFIRMATION`
- `CONFLICTING_TREND`
- `LOW_CONFIDENCE`
- `POOR_RISK_REWARD` (also `MIN_RR_TO_TP2_NOT_MET`)
- `INSUFFICIENT_EVIDENCE` (BUY/SELL require ≥2 of trend / volume-profile / confirmation families)

`AI_ENABLED` remains false by default. Broker execution remains disabled.
