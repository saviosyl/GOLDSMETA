# cTrader AutoTrade release readiness checklist

States: NOT STARTED | BLOCKED | READY | VERIFIED

Canonical architecture: [`MULTI_USER_AUTOTRADE_ARCHITECTURE.md`](./MULTI_USER_AUTOTRADE_ARCHITECTURE.md)

| Item | State |
|------|-------|
| Multi-user connection architecture coded | READY |
| Per-user Demo/Live settings coded | READY |
| TradingView standard template + private webhooks | READY |
| Pinned Auth restored | BLOCKED / verify separately |
| cTrader app approved | NOT STARTED |
| Redirect URI configured | NOT STARTED |
| Demo OAuth completed | NOT STARTED |
| Pepperstone account confirmed | NOT STARTED |
| XAUUSD metadata verified | NOT STARTED |
| Live quotes verified | NOT STARTED |
| Risk settings (per-user, recommended defaults) | READY (coded) |
| Emergency STOP (user/environment scope) tested | NOT STARTED |
| Restart recovery tested | NOT STARTED |
| First controlled Demo BUY approved | NOT STARTED |
| First controlled Demo SELL approved | NOT STARTED |
| First controlled close approved | NOT STARTED |
| Duplicate protection verified | READY (intent key coded) |
| Seven-day qualification complete | NOT STARTED |
| Demo Auto owner approval | NOT STARTED |
| Live execution / Live Auto | NOT STARTED — temporarily locked |
| Production merge / deploy | NOT STARTED — do not merge this PR as activation |

No item here authorises order placement, `scope=trading`, or production merge.
Temporary locks are deployment-state controls, not permanent Demo-only product design.
