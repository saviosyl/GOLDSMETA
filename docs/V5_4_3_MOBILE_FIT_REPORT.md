# GoldMeta V5.4.3 — Mobile Fit Revision (Preview)

**Status:** Revised preview for approval / testing. Production unchanged.

## Root causes

### Zoom (heavy zoom on phone refresh)

**Cause:** `index.html` viewport included `maximum-scale=1`, which blocks natural accessibility zoom behaviour and interacts badly with Safari / PWA refresh scaling.

**Also contributing:** Snapshot modal `<select>` used `0.875rem` (~14px). iOS Safari auto-zooms focused controls under 16px; that zoom can persist after dismiss/refresh.

**Fix:**
- Viewport is now `width=device-width, initial-scale=1, viewport-fit=cover` (no `maximum-scale`, no `user-scalable=no`)
- Mobile inputs/selects/textareas forced to **≥16px**

### Horizontal overflow

**Cause:** Market Structure Map rows used `grid-template-columns: 88px 1fr minmax(120px, 1.2fr)`, which forces a minimum width that exceeds narrow phones once card/page padding is applied. Combined with zoomed viewport, users had to pan sideways.

**Also:** `max-width: 100vw` on nav (100vw can exceed layout width on mobile Safari), account menu `min-width: 200px`, and snapshot preview not constrained with `object-fit: contain`.

**Fix:**
- Ladder stacks earlier (≤767px) with `minmax(0, …)` tracks and wrapping labels
- Replace `100vw` nav constraint with `100%`
- Shell / sections / snapshot modal: `min-width: 0`, `max-width: 100%`
- Snapshot preview: `width/max-width: 100%; height: auto; object-fit: contain`

## Links

| Item | Value |
|------|-------|
| Draft / merge PR | https://github.com/saviosyl/GOLDSMETA/pull/18 |
| Revised preview | https://preview-v5-4-3-snapshot.goldmeta-web.pages.dev |
| Tip | `70584ae` · merge `8639232` |

## Validation

- lint / typecheck pass
- vitest **133**
- Playwright **68** (36 prior + mobile-fit suite)
- production remains on V5.4.2 (`index-Bd_7E5U2.js`) until explicit promote

## Safety

backend / ios / pine untouched · V4 SHADOW · broker DISABLED

## Merge

PR #18 merged into `cursor/goldmeta-v5-4-light-theme-c2c2` as `8639232` for testing. **Production not promoted.**
