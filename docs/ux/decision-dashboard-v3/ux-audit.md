# Decision Dashboard V3 UX Audit

## Sources reviewed

- `docs/ux/mobile-plan-v2/before-after.md`
- `web/src/pages/OverviewPage.tsx`
- `web/src/components/intraday/IntradayHeaderCard.tsx`
- `web/src/components/intraday/PlanStageStepper.tsx`
- `web/src/components/intraday/PrimaryPlanCard.tsx`
- `web/src/components/intraday/StickyMobileActionBar.tsx`
- `web/src/pages/SettingsPage.tsx`
- `web/src/components/layout/AppShell.tsx`
- `web/src/pages/HelpPage.tsx`

## Current production problems

1. **The decision is not first.** The mobile fold shows page chrome, alerts, the intraday header/market bar, and the stage stepper before the user reaches the primary BUY / SELL / WAIT decision. This slows the 3-5 second understanding goal.

2. **Above-fold clutter competes with the plan.** The LIVE_RANGE / market-structure banner, market bar, price/session chips, stage rail, and refresh controls all appear before or around the decision. They are useful diagnostics, but they make the first screen feel like an operations cockpit instead of a decision dashboard.

3. **AutoTrade OFF is repeated.** AutoTrade / trading-locked copy appears in the header, intraday header, sticky summary, diagnostics, risk planner text, and footer-style disclaimers. The safety message is important, but repetition consumes premium mobile space.

4. **WAIT copy is too technical.** Primary WAIT currently uses `WAIT -- NO VALID PLAN`, "The 15-minute trade structure is incomplete", and reasons such as "Trade levels failed safety validation." These are accurate diagnostics, but they read like system errors for normal users.

5. **Safety-validation reasons are promoted too high.** Geometry failures and raw-ish safety language appear directly in the primary card. Users need plain "No valid trade plan yet" first, with technical details moved behind a "Why am I waiting?" disclosure.

6. **"Notify me" does not enable push.** The sticky mobile action can reveal a hidden note that says push notifications are not active. That creates a false affordance and does not connect to real web-push subscription or server notification preferences.

7. **No green / amber / red market-feed health summary.** The current UI has market-structure mode and source labels, but no simple market-feed health component that says whether central XAUUSD quote updates are live, limited, or unavailable.

8. **Normal users still see TradingView setup.** Desktop Tools, mobile More, Settings, Help, and setup pages still expose TradingView setup for ordinary approved users. This contradicts the shared central market-feed model and implies each user must configure alerts.

9. **Entry / Stop / TP are not always first-class for pending valid plans.** Pending or conditional plans can hide levels because `tradePlan.actionable` is false. Product V3 needs POTENTIAL BUY/SELL to show the valid entry zone, stop, and targets while clearly saying confirmation is pending.

10. **Bias can look like an entry signal.** V2 added "Market bias: ... context only", but bias still sits near the top market header before the actual decision. On a small screen, users can anchor on bullish/bearish context before seeing whether a valid plan exists.

11. **Detailed research is exposed as cockpit controls.** Research tabs, market ladder, expected range, scenarios, and system diagnostics are valuable, but the hierarchy still feels like expert tooling. V3 should collapse them under understandable report sections below the quick dashboard.

12. **Admin and normal setup concerns are mixed.** TradingView connection creation, webhook reveal/revoke, and template setup are ordinary Settings/Tools paths. The shared-feed admin checklist belongs behind OWNER/ADMIN role checks.

## UX direction for V3

- Put feed health, decision, plan state, levels, confirmation, next action, and phone alerts in one mobile-first card.
- Limit the initial fold to the few facts required to decide whether to wait, monitor, or manually review a ready plan.
- Use plain language in the primary UI and preserve raw codes in diagnostics only.
- Treat support/resistance and bias as context, never as entries.
- Make notifications useful without requiring push permission; in-app notification centre and preferences should work even when browser push is denied or unsupported.
- Hide TradingView setup from normal users and explain that GoldMeta's market feed is centrally managed.
