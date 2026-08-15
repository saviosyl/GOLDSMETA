# Gold Hunter Admin Demo v1 — selective reuse from PR #126

## Reused from PR #126 (validated research)

| Component | Why |
|-----------|-----|
| `web/src/lib/formatResearchLocalTime.ts` (+ tests) | DST-safe local timestamps + UTC tooltip companion for Monitor/Performance |
| Concepts: transport vs feed separation | Status health cards separate TRANSPORT vs MARKET FEED |
| Concepts: market-closed / stale feed honesty | No fabricated quotes; HARD_STALE / STALE classification by age |
| Concepts: DEMO_ONLY execution boundary | Absolute Live refuse in order gates + `/live/arm` |

## Deliberately NOT imported from PR #126

- Full research collector / Cloud Run deployment artifacts
- Research reconnect storm / stale-feed full-session reconnect behaviour
- Research capture process / campaign env
- Micro-edge transport heartbeat implementation (kept as concepts only)
- FAST A/B/C threshold tuning / strategy optimization
- Wholesale merge of research monitor UI as the product

## Product branch

- Base: `cursor/production-connection` @ `92d0240370a81f655350356f93b2a3ca50859b28`
- Branch: `cursor/gold-hunter-admin-demo-v1-ffd6`
- Does **not** merge PR #126
