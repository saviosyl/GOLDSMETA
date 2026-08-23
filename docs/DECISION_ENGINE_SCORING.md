# Decision Engine Scoring

Config file: `backend/src/config/decisionEngine/v1.0.0.json`  
Stamped on every result as `configVersion: "decision-engine-1.0.0"`.

## Philosophy

- Score bullish and bearish factors separately. Never flip a bullish rule into a synthetic bearish mirror unless the market evidence itself is bearish.
- Missing indicators reduce confidence and add warnings. Absence does not invent direction.
- A single indicator cannot alone produce BUY/SELL (`minIndependentFactors: 3`).
- Trade plan geometry uses structure + ATR buffer. Targets prefer the farther of structure vs ATR multiples so nearby HVNs do not collapse RR — but wide stops with nearby targets still fail RR guards.

## Weights (v1.0.0)

| Factor | Bullish | Bearish | Notes |
| --- | ---: | ---: | --- |
| trendMeter | 18 | 18 | Scaled by strength 0–100 |
| marketStructure | 12 | 12 | Acceptance beyond nearby S/R |
| confirmationCandle | 12 | 12 | Breakout/retest full; continuation 0.75 |
| emaAlignment | 10 | 10 | Full stack or partial |
| pocPosition | 8 | 8 | Above/below POC |
| valueArea | 8 | 8 | Above VAH / below VAL; mild hold near edge |
| volumeConfirmation | 8 | 8 | Relative volume ≥ `volumeConfirmMult` |
| vwapAlignment | 7 | 7 | Price vs VWAP with non-conflicting trend |
| supportResistance | 6 | 6 | Caution when pressed into opposite wall |
| rsiCondition | 5 | 5 | Asymmetric oversold/overbought with trend |
| dataCompleteness | 5 | 5 | Shared completeness credit |
| atrVolatility | 3 | 3 | Usable ATR band (neutral contribution) |
| spread | 3 | 3 | Tight spread credit |
| newsRisk | 0 | 0 | Never awards direction; hard-blocks instead |

## Thresholds

| Key | Default | Role |
| --- | ---: | --- |
| `minTradeScoreToBuy` / `Sell` | 60 | Tentative directional gate |
| `minConfidenceToTrade` | 65 | Hard WAIT below this |
| `minIndependentFactors` | 3 | Multi-factor confirmation |
| `minRiskRewardTp1` | 1.0 | TP1 RR floor |
| `minRiskRewardTp2` | 1.5 | TP2 RR floor |
| `maxSpread` | 0.8 | Excessive spread WAIT |
| `staleAfterMs` | 300000 | Stale data WAIT |
| `conflictScoreGapMax` | 18 | Disagreement when both sides active |
| `structureProximityAtrMult` | 0.15 | Near-level detection |
| `stopAtrBufferMult` | 0.25 | Buffer beyond structure |
| `tp1AtrMult` / `tp2` / `tp3` | 1.0 / 2.0 / 3.2 | ATR target multiples |

## Grade bands

| Grade | Min trade score |
| --- | ---: |
| A+ | 88 |
| A | 78 |
| B | 68 |
| C | 55 |
| No Trade | WAIT or below C |

## Penalties (confidence)

| Flag / condition | Penalty |
| --- | ---: |
| missingIndicator (each warning) | 4 |
| indicatorDisagreement | 12 |
| insideConflictZone | 20 |
| staleData | 25 |
| excessiveSpread | 20 |
| highImpactNews | 30 |
| poorRiskReward | 18 |
| invalidGeometry | 25 |

## Trade score derivation

```
net = |bullish − bearish|
agreement = net / (bullish + bearish)
tradeScore ≈ net * agreement + min(bullish, bearish) * 0.15
```

If bullish − bearish ≥ 8 → dominant BULLISH (score at least round(bullish)).  
If bearish − bullish ≥ 8 → dominant BEARISH.  
Otherwise dominant NONE → WAIT.

WAIT results cap displayed trade score at 60 and force `setupGrade: "No Trade"`.

## Management params

| Key | Default | Meaning |
| --- | ---: | --- |
| `partialProfitR` | 1.0 | TAKE_PARTIAL once ≥ this R (and TP1 hit path) |
| `breakevenAfterR` | 0.8 | MOVE_SL_TO_BREAKEVEN |
| `earlyExitAdverseR` | −0.6 | EXIT_EARLY on adverse R + deterioration |
| `trendDeteriorationStrength` | 55 | Trend strength needed to confirm early exit |

## Config reference location

- Runtime config: `backend/src/config/decisionEngine/v1.0.0.json`
- Loader: `backend/src/services/decisionEngine/configLoader.ts`
- New versions: add `vX.Y.Z.json` and pass `configVersion: "X.Y.Z"` to `evaluateDecision`.
