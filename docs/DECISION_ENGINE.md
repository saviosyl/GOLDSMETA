# Decision Engine

The GoldMeta decision engine is deterministic first. It converts validated market snapshots into BUY, SELL, or WAIT decisions, then optionally asks AI to explain or review conflicts.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## Core rule

When data is incomplete, stale, invalid, or contradictory beyond configured tolerance, the safe output is `WAIT`.

GoldMeta must never fabricate missing proprietary volume profile, TPO, market profile, or Trend Meter inputs. Missing means missing.

## Pipeline

```text
Raw events
  -> Schema validation
  -> Source validation
  -> Snapshot merge
  -> Data quality scoring
  -> Deterministic setup scoring
  -> Hard guards
  -> Trade plan generation
  -> Optional AI explanation/conflict review
  -> Final safety validation
  -> Stored decision + notification
```

## Data quality

Suggested quality states:

| State | Meaning | Default behavior |
|---|---|---|
| `GOOD` | Required inputs are present, fresh, and internally consistent. | Decision may be BUY, SELL, or WAIT. |
| `PARTIAL` | Some optional inputs are missing. | Decision may proceed only if hard guards allow. |
| `STALE` | Inputs are too old for the active timeframe. | WAIT. |
| `CONFLICTED` | Sources disagree materially. | WAIT unless conflict is explicitly tolerated. |
| `INVALID` | Schema, symbol, timeframe, or value validation failed. | Reject or WAIT. |

## Setup score

The setup score is a deterministic number from `-100` to `100`.

- Positive scores support BUY.
- Negative scores support SELL.
- Scores near zero support WAIT.

Example thresholds:

| Score | Decision candidate |
|---|---|
| `>= 70` | BUY candidate |
| `<= -70` | SELL candidate |
| otherwise | WAIT |

Thresholds are candidates only. Hard guards can always downgrade to WAIT.

## Hard guards

Hard guards protect against invalid plans:

- Unsupported symbol.
- Unsupported timeframe.
- Missing current OHLCV.
- Unconfirmed bar when confirmed-bar mode is required.
- Stale snapshot.
- Stop loss on wrong side of entry.
- Risk/reward below minimum.
- Higher-timeframe conflict above tolerance.
- Required proprietary input missing.
- Excessive spread or abnormal volatility, if those inputs are available.
- News/session restrictions, if configured.

Hard guards should be versioned and auditable.

## Trade plan generation

A trade plan should include:

- Entry type: market, limit, entry zone, wait for confirmation, or none.
- Entry price or zone.
- Stop loss and reason.
- Take-profit levels and reasons.
- Risk/reward per target.
- Breakeven rule.
- Early-exit conditions.
- Invalidation condition.

For `WAIT`, use `entry.type = "NONE"` or `WAIT_FOR_CONFIRMATION` and avoid pretending there is a live trade plan.

## Confidence

Confidence is setup quality and input completeness.

Confidence is **not**:

- Win probability.
- Profit probability.
- A guarantee.
- A reason to ignore invalidation or risk rules.

Example interpretation:

| Confidence | Meaning |
|---|---|
| Low | Weak or incomplete setup. |
| Moderate | Some support, but important uncertainty remains. |
| High | Strong alignment among available validated inputs. |
| Very high | Rare, high-quality alignment with complete required inputs. |

Even very high confidence can lose.

## AI role

AI may:

- Explain the deterministic decision in plain language.
- Summarize bullish and bearish evidence.
- Flag contradictions.
- Recommend a WAIT downgrade for safety review.

AI must not:

- Create prices, levels, profile values, or trend meter outputs.
- Override hard guards.
- Change BUY/SELL thresholds without a versioned rule update.
- Use language implying guaranteed profit.

## Audit fields

Every stored decision should include:

- `decisionId`
- `schemaVersion`
- `ruleConfigVersion`
- `backendVersion`
- `pineScriptVersion`, when applicable
- `snapshotId`
- `marketDataTime`
- `generatedAt`
- `validUntil`
- `reasonCodes`
- `warnings`
- `missingInputs`
- `dataQuality`
- `setupScore`
- `confidence`
- `disclaimer`

## Testing

Test fixtures should cover:

- Valid BUY, SELL, and WAIT outcomes.
- Missing proprietary inputs.
- Stale TradingView payloads.
- Unsupported symbols.
- Duplicate webhook events.
- Conflicting timeframe bias.
- Invalid stop loss calculations.
- AI unavailable fallback.

The expected output for uncertain or unsafe scenarios is WAIT.
