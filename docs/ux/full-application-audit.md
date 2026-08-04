# GoldMeta full application audit

**Baseline:** production `cursor/v5-4-3-approved-base-c2c2` @ `5bb5a04163d124e04ba16eedd41b64888263bc53`  
**PR #59 geometry gate:** present (`tradePlanGeometry.ts`, `NO_VALID_PLAN`)  
**Production bundle at audit start:** `index-KHj3hXtE.js`  
**Firebase project:** `goldmeta-web`  
**Trading:** AutoTrade OFF · Demo OFF · Live OFF  

**Auth coverage note:** No securely configured test password was available in this environment. Public/auth shells and signed-out routes were live-inspected. Authenticated pages were reviewed via source + unit/fixture renders + production HTML shells. Live authenticated production click-through is marked where incomplete.

| Route | Purpose | User | Strengths | Problems | Action | Live auth |
| --- | --- | --- | --- | --- | --- | --- |
| `/` (Sign-in catch-all when signed out) | Sign in | Public | Clear brand | Duplicate brand chrome historically | SIMPLIFY | Yes (public) |
| `/register` | Create account | Public | Works | Dense copy | SIMPLIFY | Yes (public) |
| `/registration-complete` | Post-register | Public | Status clear | Visual inconsistency | KEEP | Yes (public) |
| `/password-reset-sent` | Reset sent | Public | Clear | — | KEEP | Yes (public) |
| `/verify-email` | Verify email | Auth | Gate | — | KEEP | Source |
| `/account-ready` | Ready status | Auth | — | — | KEEP | Source |
| `/awaiting-approval` | Pending approval | Auth | Clear | — | KEEP | Source |
| `/account-suspended` | Suspended | Auth | Clear | — | KEEP | Source |
| `/account/delete-request` | Deletion request | Auth | Legal path | Buried | KEEP | Source |
| `/legal/terms` | Terms | Public/Auth | Present | Dense legal | KEEP | Yes (public) |
| `/legal/privacy` | Privacy | Public/Auth | Present | Dense | KEEP | Yes (public) |
| `/legal/risk` | Risk disclosure | Public/Auth | Present | Dense | KEEP | Yes (public) |
| `/` Plan | Daily plan | Approved | Geometry gate, primary card | Research tabs crowd plan; duplicated chrome | SIMPLIFY | Source+fixture |
| `/analysis` | Decision analysis | Approved | Detail | Duplicates Plan/Research | HIDE FROM NAVIGATION | Source |
| `/intelligence` Markets | Market context | Approved | Ask GoldMeta | Technical impl copy; not daily-context first | SIMPLIFY | Source |
| `/v4` Research | Stage B research | Approved | Research depth | Primary nav competes with Plan | COMBINE (via More→Research) | Source |
| `/analytics` | Premium analytics | Approved | Filters | Overlaps Performance | COMBINE | Source |
| `/analytics/v3` | Legacy analytics | Approved | Historical | Duplicate menu risk | HIDE FROM NAVIGATION | Source |
| `/signal-performance` | Signal stats | Approved | Sample messaging | Buried | COMBINE → Performance | Source |
| `/history` | Archive list | Approved | Filters | Should sit under Journal | HIDE FROM NAVIGATION (via Journal) | Source |
| `/history/:decisionId` | Decision detail | Approved | Detail | Layout drift vs setups | SIMPLIFY | Source |
| `/setups/:setupId` | Setup detail | Approved | Lifecycle | Naming inconsistency | SIMPLIFY | Source |
| `/replay` | Replay | Approved | Educational | Dense controls | SIMPLIFY | Source |
| `/journal` | Manual notes | Approved | Safe | Minimal; not review workspace | SIMPLIFY/expand | Source |
| `/planner` | Risk planner | Approved | Manual only | Compact but needs warnings | SIMPLIFY | Source |
| `/tradingview` | TV setup | Approved | Webhook roles | Not wizard-like | SIMPLIFY | Source |
| `/brokers` | Broker centre | Approved | Locked | Looks actionable | HIDE FROM NAVIGATION | Source |
| `/autotrade` | AutoTrade | Approved | OFF shown | Primary-nav noise | HIDE FROM NAVIGATION | Source |
| `/diagnostics` | Diagnostics | Admin | Codes | Must stay admin | ADMIN ONLY | Source |
| `/settings` | Settings | Auth | Tabs | Too many groups | SIMPLIFY | Source |
| `/help` | Help | Auth | Glossary | Outdated steps (Demo broker) | SIMPLIFY | Source |
| `/brand` | Brand showcase | Public/Auth | Assets | Not daily nav | HIDE FROM NAVIGATION | Yes (public) |
| `/admin/users` | User admin | Staff | Roles | — | ADMIN ONLY | Source |
| `/admin/tradingview-template` | TV template | Staff | Versions | — | ADMIN ONLY | Source |
| `/ui-review/*` | Preview gate | Dev | Fixture isolation | Not production nav | KEEP (gated) | N/A |

**States reviewed in Plan/components (fixture + unit):** loading, empty/NO_VALID_PLAN, NO_TRADE, BUY, WAIT, stale/offline banners, geometry blocked levels.

**Routes reviewed count:** 35 routed surfaces from `App.tsx` (including public catch-all sign-in and not-found).

## Recommended primary navigation

**Mobile:** Plan `/` · Markets `/intelligence` · Journal `/journal` · More (sheet)  
**Desktop groups:** Daily / Research / Tools / Account / Admin  
**Legacy URLs preserved;** Analysis/History/Analytics remain reachable, not primary nav.
