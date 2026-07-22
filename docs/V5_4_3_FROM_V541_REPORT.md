# GoldMeta V5.4.3 — from approved V5.4.1 (`c7e427d`)

**Status:** Corrective preview only. **Do not merge / do not promote.**  
**PR #19:** superseded — do not merge.  
**Production:** unchanged.

## Identity

| Item | Value |
|---|---|
| Branch | `cursor/v5-4-3-from-approved-v5-4-1-c2c2` |
| Draft PR | https://github.com/saviosyl/GOLDSMETA/pull/20 |
| Preview | https://preview-v5-4-3-from-v541.goldmeta-web.pages.dev |
| Exact base | `c7e427d` (V5.4.1 Premium UX; parent `87171ca`) |
| Tip | see latest on branch |
| Based on `384eb56`? | **No** (`384eb56` is not an ancestor) |
| Production asset | still `index-Bd_7E5U2.js` |

## What was added (only)

1. **Share Market Snapshot** — dedicated modules + surgical OverviewPage insertion  
2. **Mobile refresh zoom** — viewport without `maximum-scale=1`; ≥16px controls in mobile MQ only  
3. **Narrow horizontal-fit** — ladder `minmax(0,…)`, label wrap, nav `max-width: 100%`, snapshot modal/preview constraints  

## Snapshot files ported

- `web/src/components/v5/PromoSnapshotButton.tsx`
- `web/src/components/v5/PromoSnapshotModal.tsx`
- `web/src/hooks/usePromoSnapshot.ts`
- `web/src/lib/promoSnapshot.ts`
- `web/src/lib/promoSnapshotRender.ts`
- `web/src/lib/promoSnapshotShare.ts`
- `web/src/lib/PromoSnapshot.test.tsx`
- `web/src/lib/marketStory.ts` (lib dependency for snapshot story text only; **no MarketStoryCard UI**)

Formats: 1080×1350, 1080×1920, 1080×1080, 1200×675.

## Mobile-fit CSS (exact)

`web/index.html` — viewport `width=device-width, initial-scale=1, viewport-fit=cover`

`web/src/styles/global.css`

- `.nav { max-width: 100% }` (was `100vw`)
- ≥16px `input/select/textarea` **inside** `@media (max-width: 767px)` only

`web/src/styles/redesign.css` (c7e427d preserved + append)

- `.gm-mobile-nav` width/max-width 100% + box-sizing
- `.gm-ladder-row` tracks `minmax(0, 88px) …` / mobile `minmax(0, 76px)` @ **640px** (breakpoint unchanged)
- `.gm-ladder-labels` overflow-wrap
- scoped `.gm-snapshot-*` block only (no late `.gm-btn-primary` / no global overflow-x clip)

## Visual comparison (fresh from `c7e427d`)

See `docs/v5-4-3-from-v541/compare-*.png`.

- Desktop: only expected delta is Share Market Snapshot button  
- Mobile 390/430 first viewport, sign-in, settings, expanded colourful score: sampled diff ≈ 0  
- Score statuses: Strong green / Partial amber / Weak red / Unavailable neutral  

## Overflow

All deltas `0` at 320×568, 360×800, 375×812, 390×844, 393×852, 430×932  
(`docs/v5-4-3-from-v541/overflow-measurements.json`)

## Tests

| Suite | Result |
|---|---|
| lint | pass |
| typecheck | pass |
| Vitest | 125 passed |
| Playwright | 66 passed |
| production build | pass |
| secret scan | clean |

## Safety

No `backend/` `ios/` `pine/` Firebase / V3 / V4 / score math / broker changes.  
V4 SHADOW-only. Broker DISABLED. **No merge. No promote.**
