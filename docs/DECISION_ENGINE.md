# Decision Engine

Deterministic XAUUSD decision support for GoldMeta. Same structured inputs + config version always produce the same result. The engine never submits broker orders.

## Role

- Accept structured market-analysis inputs (missing indicators allowed).
- Return exactly one primary action: `BUY` | `SELL` | `WAIT`.
- Emit a versioned JSON result with confidence, trade score, setup grade, levels, reasons, warnings, and score breakdown.
- Expose a separate management evaluator: `HOLD` | `TAKE_PARTIAL` | `MOVE_SL_TO_BREAKEVEN` | `EXIT_EARLY`.

## Module layout

```
backend/src/services/decisionEngine/
  types.ts          Zod contracts (input, result, management, config)
  configLoader.ts   Loads versioned JSON config
  scoring.ts        Bullish/bearish factor scoring
  guards.ts         Hard WAIT rules
  tradePlan.ts      Structure + ATR stops/targets (no fixed-distance-only)
  confidence.ts     Confidence with penalties
  engine.ts         evaluateDecision()
  management.ts     evaluateManagement()
  index.ts          Public exports

backend/src/config/decisionEngine/v1.0.0.json
```

The older webhook path under `backend/src/services/decision/*` is unchanged. This engine is additive and analysis-only until a later integration task.

## Public API

```ts
import { evaluateDecision, evaluateManagement } from "./services/decisionEngine";

const result = evaluateDecision(input, { configVersion: "1.0.0", evaluatedAt: "..." });
const management = evaluateManagement(openPosition);
```

`result.analysisOnly` is always `true`.

## Output contract (v1.0)

| Field | Meaning |
| --- | --- |
| `primaryAction` | BUY / SELL / WAIT |
| `confidence` | 0–100 |
| `tradeScore` | 0–100 |
| `setupGrade` | A+ / A / B / C / No Trade |
| `entryType` | market / limit / breakout / retest / none |
| `entryRange` | low / high / reference |
| `stopLoss`, `takeProfits`, `riskReward` | Plan geometry |
| `invalidationLevel` | Beyond stop |
| `supportingReasons` / `opposingReasons` | Human notes |
| `missingDataWarnings` | Missing indicators reduce confidence; absence never invents direction |
| `recommendedManagementAction` | ENTER or WAIT_FOR_CLOSE for new analysis |
| `explanation` | Short narrative |
| `scoreBreakdown` | Per-factor weight / awarded / side / note |
| `safetyFlags` | Hard-guard codes when WAIT |
| `configVersion` | e.g. `decision-engine-1.0.0` |

## Hard WAIT rules

- Stale market data
- Excessive spread
- High-impact news window
- Structure conflict zone (support and resistance both immediate)
- Indicator disagreement (bullish vs bearish gap too small)
- Fewer than `minIndependentFactors` (default 3)
- Poor risk/reward vs config floors
- Invalid trade geometry
- Confidence below `minConfidenceToTrade`

## Management evaluator

Priority: `EXIT_EARLY` → `TAKE_PARTIAL` → `MOVE_SL_TO_BREAKEVEN` → `HOLD`.

No martingale, averaging down, grid, or loss-chasing logic.

## iOS dashboard

Mock fixtures `strong_buy`, `strong_sell`, and `conflicted_wait` are generated from engine outputs. The dashboard shows:

- Primary action prominently
- Trade score + setup grade
- Management recommendation
- Score breakdown
- Explicit **Analysis only — not an executed trade** banner

## Examples

See `docs/examples/decisionEngine/` for BUY / SELL / WAIT input+output pairs.

## Deferred

- Wiring into the live TradingView webhook pipeline
- Live broker execution / Live Auto unlock
- Replacing `services/decision/*` wholesale
