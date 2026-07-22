# GoldMeta V5.4.3 — Promotional Market Snapshot (Preview)

**Status:** Preview only — do not merge or promote until Savio approves.

## Links

| Item | Value |
|------|-------|
| Draft PR | https://github.com/saviosyl/GOLDSMETA/pull/18 |
| Preview alias | https://preview-v5-4-3-snapshot.goldmeta-web.pages.dev |
| Direct deploy | https://bb16b91c.goldmeta-web.pages.dev |
| Review shell | https://preview-v5-4-3-snapshot.goldmeta-web.pages.dev/ui-review/ |

## Base / tip

| Item | Value |
|------|-------|
| Base branch | `cursor/goldmeta-v5-4-light-theme-c2c2` |
| Base commit | `384eb56` |
| Feature branch | `cursor/goldmeta-v5-4-3-promo-snapshot-c2c2` |
| Tip | `2a374e3` |
| Changed files | 21 · +1839 / −19 |
| Paths | `web/` + `docs/` only |

## Feature

Share Market Snapshot — purpose-built GoldMeta-branded PNG for WhatsApp / Instagram / social promo.

- Formats: Social 1080×1350 (default), Story 1080×1920, Square 1080×1080, Compact 1200×675
- Verified data only
- Native Share sheet when supported; Download PNG fallback
- Light / dark branded styles; optional story / plan / score sections
- Accessible modal (Escape, focus trap, status announcements)

## Validation

| Check | Result |
|-------|--------|
| lint / typecheck | pass |
| vitest | **133** |
| Playwright | **36** |
| production build | pass |
| secret scan | clean |
| Download PNG fallback | pass (headless) |
| Native Share sheet | `canShare` unavailable in headless Chromium — use device for iPhone Share-sheet confirmation |

## Samples

`docs/v5-4-3-snapshots/` and `/opt/cursor/artifacts/v543/`

## Safety

- `backend/` `ios/` `pine/` untouched
- Score math / V3 / V4 SHADOW-only / broker DISABLED unchanged

## Stop

Await Savio’s approval. Do not merge or promote automatically.
