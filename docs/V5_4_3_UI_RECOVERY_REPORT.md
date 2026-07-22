# GoldMeta V5.4.3 — UI recovery (corrective preview)

**Status:** Corrective preview only. **Do not merge / do not promote.** Await Savio visual approval.  
**Production:** unchanged on V5.4.2.

## Identity

| Item | Value |
|---|---|
| Corrective branch | `cursor/fix-v5-4-3-preserve-approved-ui-c2c2` |
| Corrective PR | https://github.com/saviosyl/GOLDSMETA/pull/19 |
| Corrective preview | https://preview-v5-4-3-ui-recovery.goldmeta-web.pages.dev |
| Base (cut from) | `8639232` (V5.4.3 testing merge) |
| Visual source of truth | `384eb56` (approved V5.4.2) |
| Tip (this delivery) | `d2d3bc6` |
| Production | unchanged — V5.4.2 / assets `index-Bd_7E5U2.js` |

## Exact cause of visual drift

After `384eb56`, PR #18 / mobile-fit tip (`70584ae` → merge `8639232`) added **broad CSS** into `web/src/styles/redesign.css` that overrode the approved shell:

1. **Global layout overrides** — `* { box-sizing }`, `.gm-shell { overflow-x: clip }`, broad `max-width: 100%` / `min-width: 0` on `.gm-section`, `.gm-dash-grid`, `.gm-primary-signal`, `.gm-market-story`, etc.
2. **Market Structure Map track changes** — ladder grid switched to different mobile breakpoint (`640 → 767`) and column width (`76 → 72`).
3. **Late duplicate `.gm-btn-primary` block** after snapshot CSS — redeclared padding/radius/font and visually changed primary buttons app-wide.
4. Snapshot styles were mixed with those broad selectors instead of staying under `.gm-snapshot-*` only.

## Files restored from `384eb56`

- `web/src/styles/redesign.css` — full restore of approved V5.4.2 shell, then surgical append only

## Snapshot changes retained

Dedicated modules unchanged:

- `PromoSnapshotButton.tsx`, `PromoSnapshotModal.tsx`
- `usePromoSnapshot.ts`
- `promoSnapshot.ts`, `promoSnapshotRender.ts`, `promoSnapshotShare.ts`
- `PromoSnapshot.test.tsx` (+ e2e snapshot coverage)

`OverviewPage.tsx` keeps only the minimum insertion: import + prepare verified data + compact button under Primary Signal + modal.

Snapshot CSS uses only `.gm-snapshot-*` selectors (no late `.gm-btn-primary` redefinition).

## Mobile-fit changes retained

- Viewport: `width=device-width, initial-scale=1, viewport-fit=cover` (no `maximum-scale=1` / `user-scalable=no`)
- ≥16px form control text **only inside mobile media queries** (`global.css` + `.gm-snapshot-field select`)
- Narrow overflow fixes only:
  - ladder tracks `minmax(0, …)` while keeping approved `88px` / `76px` @ `640px`
  - label / nearest wrapping
  - `.gm-mobile-nav` / `.nav` `max-width: 100%` (not `100vw`)
  - account dropdown max-width clamp
  - snapshot modal / preview width constraints

## Overflow measurements (repaired)

All deltas `0` at 320 / 360 / 375 / 390 / 393 / 430 (see `docs/v5-4-3-ui-recovery/overflow-measurements.json`).

## Visual comparison

Side-by-side frames in `docs/v5-4-3-ui-recovery/compare-*.png`.

Expected differences vs `384eb56`: Share Market Snapshot button (and modal when opened). Sign-in / Settings matched with `sampled_diff_ratio: 0`.

## Tests

| Suite | Result |
|---|---|
| lint | pass |
| typecheck | pass |
| Vitest | 138 passed |
| Playwright | 86 passed |
| production build | pass |
| secret scan | clean (heuristic) |

## Safety

- No `backend/`, `ios/`, `pine/`, Firebase, V3/V4 logic, score, broker changes
- V4 SHADOW-only; broker DISABLED
- **No merge. No production promotion.**
