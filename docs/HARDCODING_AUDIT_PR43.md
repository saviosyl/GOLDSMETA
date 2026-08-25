# Hardcoded-setting audit (PR #43 consolidation)

Audit of decision engine, AutoTrade routes, and UI for ordinary user settings.

## Verdict

Ordinary user AutoTrade settings are loaded from `users/{uid}/autotradeSettings/{demo|live}`.
`buildLiveDemoPreview` / `connectionService` pass saved settings into the preview engine.
Recommended defaults apply only when no saved document exists or a field is omitted.

## Settings confirmed per-user (not hardcoded product overrides)

| Setting | Source |
|---------|--------|
| account type | connection `selectedAccountIsLive` / selector |
| broker account | `selectedAccountId` on connection + settings |
| risk mode / amount / % | `sizingMode`, `fixedRiskAmount`, `percentageRisk` |
| lot-sizing / manual lots | `sizingMode`, `manualLotSize` |
| max daily loss / trades / open positions | settings fields |
| confidence / RR / spread / quote age | settings fields |
| cooldowns / sessions / confirmation filters | settings fields |
| break-even / trailing / partial TPs | settings fields |

## Remaining constants — classification

### Recommended default

| Constant | Location | Notes |
|----------|----------|-------|
| `fixedRiskAmount: 20` | `userAutoTradeSettings` RECOMMENDED | First-time default only |
| `percentageRisk: 0.5`, `maxDailyLoss: 50`, `maxTradesPerDay: 3`, etc. | same | First-time defaults |
| `CTRADER_RECOMMENDED_DEFAULTS` | `flags.ts` | Preview fallback when settings not passed |
| Fixture `riskAmountEur: 20` | `cTraderService` demos, `/preview` fixture routes | Demonstration payloads only |

### Broker-derived limit

| Constant | Notes |
|----------|-------|
| Symbol min/max/step volume | From cTrader Open API metadata |
| Margin / contract size | Broker account/symbol snapshot |

### Structural security validation

| Rule | Notes |
|------|-------|
| Cross-user account/webhook isolation | UID path ownership |
| Encrypted tokens / hashed webhook secrets | Never returned to browser |
| Demo cannot inherit Live activation | Cleared on demo patches |
| Webhook cannot set UID / account / AutoTrade / risk / Live | Path + server settings |
| Numeric range clamps on patches | Validation bounds, not product caps forcing €20 |
| No martingale / grid / blind retry | Engine policy |

### Temporary preview lock

| Lock | Notes |
|------|-------|
| `isCTraderDemoOrderSubmissionEnabled` → false | Hard-false getter |
| `isCTraderLiveEnabled` → false | Execution only; selection allowed |
| `isBrokerExecutionEnabled` → false | Hard-false |
| AutoTrade runtime OFF | Snapshot / flags |
| OAuth `scope=accounts` | Do not request trading |

### Accidental hardcoding requiring correction

| Item | Status |
|------|--------|
| Preview ignoring saved `minConfidence` / caps | **Fixed** — accepts per-user inputs |
| Broker UI “Max risk €20” as server product cap | **Fixed** — copy updated |
| Snapshot “Impossible to activate” / Demo-only naming | **Fixed** — temporary-lock wording |
| Production decision path silently forcing €20 over saved settings | **None found** in AutoTrade preview path |

## Historical docs

Stage3 / V4 reports that mention €20 remain labeled **historical**; they are not current product hard caps.
