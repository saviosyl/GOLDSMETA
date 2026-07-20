# Trading modes

GoldMeta supports four trading modes. None of them promise profits. Position size is never increased to recover losses. Martingale, grid recovery, and uncontrolled averaging down are forbidden and cannot be enabled.

## Modes

| Mode | Behaviour |
|---|---|
| **Manual** | Analysis + trade instructions only. No order submission. |
| **Confirm** | Builds a complete proposed order. Requires Face ID / explicit confirmation before any submission attempt. |
| **Demo Auto** | Full strategy on **simulated funds**. Records decisions, orders, results, drawdown, and performance metrics. |
| **Live Auto** | Locked until demo-testing requirements are met **and** the user manually enables it. Executes only actions the selected broker API officially supports. |

## Live Auto unlock

Live Auto stays locked until:

1. Demo Auto records at least **N closed simulated trades** (default 20), and
2. Demo testing has run for at least **D calendar days** (default 7), and
3. The user explicitly enables Live Auto in Settings.

Even when unlocked, Live Auto is blocked while emergency stop is active, risk controls fail, or the broker adapter reports missing capabilities for the requested action.

## Broker adapters

- `trading212_manual` — instructions only for XAUUSD (see `TRADING_212_API_VERIFICATION.md`).
- `demo_simulated` — internal simulated broker for Demo Auto.
- Future adapters implement `BrokerAdapter` with an explicit capability matrix (entry, SL, TP, partial close, breakeven, early exit, cancel pending).

Live Auto never calls an action the adapter marks unsupported.

## Strict risk controls

All auto/confirm submission paths enforce:

- Max risk per trade (%)
- Max daily loss (%)
- Max trades per day
- Minimum confidence
- Maximum spread
- Slippage tolerance
- Stale-data block
- Duplicate-signal block
- High-impact-news block

Hard-coded: no martingale, no grid recovery, no averaging down to recover losses.

## Emergency stop

**Stop Auto Trading** immediately:

1. Blocks all new automated/proposed submissions
2. Attempts to cancel pending orders on the active adapter
3. Leaves Manual analysis available

## Credentials

Broker credentials are accepted only on authenticated backend endpoints and stored as **encrypted backend secrets**. They must never appear in the iOS app, logs, source tree, or GitHub.
