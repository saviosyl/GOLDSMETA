# GoldMeta User Guide

GoldMeta is a personal XAUUSD market analysis assistant for iPhone.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## What GoldMeta does

- Receives TradingView market alerts.
- Validates and merges market inputs.
- Produces BUY, SELL, or WAIT analysis.
- Shows entry, stop, targets, invalidation, and reasoning when a trade setup is valid.
- Sends push notifications when new analysis is ready.
- Lets you review history and journal outcomes.

GoldMeta does not place trades for you.

## Decisions

### BUY

A BUY decision means the deterministic rules found enough bullish evidence after safety checks. Review:

- Entry type and price/zone.
- Stop loss.
- Take-profit levels.
- Risk/reward.
- Invalidation.
- Bullish and bearish evidence.
- Warnings and missing inputs.

### SELL

A SELL decision means the deterministic rules found enough bearish evidence after safety checks. Review the same risk details before making any decision.

### WAIT

WAIT is an active safety output. It may appear when:

- The setup score is not strong enough.
- Data is stale or incomplete.
- Proprietary inputs are missing.
- Higher timeframes conflict.
- Risk/reward is poor.
- A hard guard blocks the trade.
- The current bar is not confirmed.

WAIT does not mean "nothing is happening"; it means GoldMeta does not have a safe actionable setup under its rules.

## Confidence

Confidence describes setup quality and input completeness.

Confidence is not win probability. A high-confidence setup can lose, and a low-confidence setup can still move favorably. Always use your own risk controls.

## Notifications

Notifications tell you that new analysis is ready. Open the app to review the full decision before acting.

Recommended notification handling:

1. Read the decision and timestamp.
2. Confirm the chart still matches the setup.
3. Review invalidation and stop loss.
4. Check warnings and missing inputs.
5. Decide independently whether to trade.

## Live setup overview

To use live alerts:

1. Deploy the Firebase backend.
2. Create your GoldMeta webhook connection.
3. Add `GoldMetaBridge.pine` to an XAUUSD TradingView chart.
4. Create a TradingView webhook alert.
5. Enable iOS push notifications.
6. Send a test alert.
7. Confirm the app receives a WAIT/TEST or analysis update.

See:

- `docs/FIREBASE_SETUP.md`
- `docs/TRADINGVIEW_SETUP.md`
- `docs/PUSH_NOTIFICATIONS.md`

## Journal

Use the journal to record:

- Whether you took the trade.
- Entry and exit notes.
- Screenshots or observations, if supported.
- Emotional state and rule adherence.
- Lessons learned.

Journal statistics are for review, not a promise of future performance.

## Data and privacy

GoldMeta should let you:

- Sign out.
- Review stored decisions.
- Delete journal entries.
- Request data export, if implemented.
- Request account/data deletion, if implemented.

Do not share webhook URLs publicly. Anyone with a valid webhook URL may be able to send events unless additional backend protections are enabled.

## Common issues

| Issue | Meaning |
|---|---|
| No decisions appear | TradingView alert, webhook URL, backend deployment, or auth may not be configured. |
| All decisions are WAIT | Data may be incomplete, stale, or blocked by hard guards. |
| Symbol warning | The TradingView chart is not XAUUSD. |
| Push not received | Notification permission, FCM token registration, or backend sending may need attention. |
| Confidence seems high but decision is WAIT | A hard guard can override score/confidence. |

## Safety reminders

- Use position sizing you understand.
- Know your invalidation before entering.
- Do not trade solely because of a notification.
- Do not treat GoldMeta as financial advice.
- Stop using live decisions if data appears delayed or incorrect.
