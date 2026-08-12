# Controlled Demo qualification vs Demo Auto authority

## Intended behaviour

| State | Owner `autoTradeEnabledIntent` | May submit Pepperstone Demo orders? |
|------|--------------------------------|-------------------------------------|
| `CONTROLLED_DEMO_QUALIFICATION` | not required | Yes — **controlled ladder only**, via `evaluateControlledDemoOrderAuthority` |
| `DEMO_AUTO_ENABLED` | **must be true** | Yes — autonomous path via `evaluateDemoAutoExecutionAuthority` |
| `LIVE_QUALIFICATION` | **must be true** | Yes — same autonomous path |
| Any other | — | No |

## Rules

1. **CONTROLLED_DEMO_QUALIFICATION** is an explicit, separate permission for the
   qualification ladder (limited controlled Demo trades before Demo Auto is enabled).
2. Once the account is in **DEMO_AUTO_ENABLED** or **LIVE_QUALIFICATION**,
   `CONTROLLED_DEMO` must **not** bypass the owner's Demo Auto OFF switch.
3. Autonomous submission fails closed on `INTENT_OFF`, pause, emergency stop,
   accounts-only OAuth, Live account, or Demo submission flag false.
4. Live money execution remains hard-locked everywhere.

## Three display states

- **A Demo Auto ENABLED** — `demoAutoAuthority.enabled`
- **B Submission AUTHORIZED** — `demoAutoAuthority.submissionAuthorized`
- **C Execution ELIGIBLE NOW** — `demoAutoAuthority.executionEligible` /
  `executionNowLabel` (e.g. `WAITING — MARKET CLOSED` when authorized but market closed)
