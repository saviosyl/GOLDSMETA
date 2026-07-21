# GoldMeta V5 — Trading Intelligence Platform

**Date:** 2026-07-21  
**Branch:** `cursor/goldmeta-v5-intelligence-c2c2`  
**Base:** `cursor/goldmeta-v4-stage-b-c2c2` (V4 Stage B)  
**Backend version:** `1.4.0-v5-intelligence`  
**V5 engine:** `1.0.0-v5-intelligence`

## Architecture

V5 is an **intelligence layer** on top of V3 production + V4 LIVE SHADOW:

```
TradingView → V3 decision (unchanged) → V4 shadow (non-fatal)
                                      ↘
                                   V5 APIs (explain / educate / analytics)
                                      ↘
                                   Web premium UI
```

- Deterministic **V4 remains the only research decision engine**.
- V5 **never overrides V4**, never places orders, never enables broker execution.
- Intelligence answers always separate **Verified data** vs **Explanation**.
- Missing data → **Insufficient verified data** (no invented prices/news/performance).

### Backend modules (`backend/src/services/v5/`)

| Module | Role |
| --- | --- |
| `marketIntelligence.ts` | GoldMeta-specific Q&A |
| `goldMetaScore.ts` | Transparent 0–100 quality score (not probability) |
| `glossary.ts` | Offline indicator explanations |
| `briefing.ts` | Daily market briefing |
| `learningEngine.ts` | Shadow-plan statistics / insights (no rule mutation) |
| `premiumAnalytics.ts` | Filterable analytics dashboard data |
| `screenshotAnalysis.ts` | Compare chart observations to verified live data |
| `replay.ts` | Educational bar-by-bar replay |
| `personalPerformance.ts` | Private behaviour stats from journal/setups |
| `weeklyCoach.ts` | Weekly coach from verified records only |
| `routes/v5.ts` | `/v1/v5/*` API |

### Screens / routes

| Route | Screen |
| --- | --- |
| `/` | Dashboard + daily briefing + GoldMeta Score |
| `/intelligence` | Ask GoldMeta, screenshot compare, weekly coach, personal stats, glossary |
| `/analytics` | Premium filterable shadow analytics + learning insights |
| `/analytics/v3` | Legacy V3 setup analytics |
| `/replay` | Educational replay |
| `/v4` | V4 research (unchanged shadow UI) |

Nav: Home · Intel · Analytics · Replay · Settings (History/Journal linked from Home).

## Firestore

No new mandatory collections. V5 reads existing:

- V3 decisions / setups / journal  
- V4 `v4Analyses`, `v4Candidates`, `v4ShadowPlans`, mutations  

Optimised reads: bounded `limit` queries, in-memory filters (no new composite indexes required for V5).

## Security

- All `/v1/v5/*` require auth; user-scoped store access.
- Broker remains `DISABLED`; V5 `overridesV4=false`.
- Diagnostics remain admin-gated.
- No secrets in client; glossary offline.

## Accessibility / UX

- Glossary terms are buttons with `aria-expanded` / dialog labelling.
- `prefers-reduced-motion` disables V5 entrance animations.
- Verified vs Explanation sections on every intelligence answer.
- Sample-size warnings on analytics.

## Performance

- Route-level page split via React Router (pages lazy-loadable later).
- Bounded API limits (replay/analytics caps).
- Glass UI uses CSS only (no heavy chart libs added in V5).
- PWA shell unchanged; offline cache for latest decision retained.

## Tests

| Suite | Result |
| --- | --- |
| Backend unit/integration (incl. V5) | run in CI / local |
| Web lint / typecheck / tests / build | run in CI / local |

Covered: score, intelligence insufficient-data honesty, learning non-mutation, briefing non-actionable, screenshot `createsTrade=false`, replay educational, glossary offline, V5 routes auth envelopes.

## Do not

- Enable broker / automatic trading / real-money execution  
- Claim guaranteed profits  
- Merge automatically  
- Modify `ios/`  

## Remaining improvements / V6 ideas

1. True vision OCR for TradingView screenshots (optional, approved feed/model)  
2. Lazy `React.lazy` code-splitting for Intel/Replay/Analytics bundles  
3. Virtualised replay timeline for large samples  
4. Richer personal tags taxonomy + patience metrics from setup bars  
5. Push weekly coach summary (non-actionable) when VAPID configured  
6. Charting library for verified OHLC replay (when historical importer populated)  
7. Promote GoldMeta Score onto Analysis/Setup detail cards everywhere Confidence % appears  
