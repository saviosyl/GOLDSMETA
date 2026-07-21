# GoldMeta V5.3.1 — Sign-in, responsive & brand correction

## Status

**Preview rejected V5.3 design corrected.** Production UI otherwise unchanged (scroll hotfix remains). Redesign stays preview-only. PR #14 remains draft. No production promote.

## Root cause of desktop “mobile column”

1. Signed-out shell forced `style={{ maxWidth: 480 }}` on the auth container.
2. `.gm-shell` at ≥1100px switched to `grid-template-columns: 240px 1fr`, so without a sidebar the auth layout was trapped in the **240px** first column.

Both are fixed. Signed-out / public shells force `grid-template-columns: 1fr`.

## Corrected preview

| Item | Value |
|---|---|
| Branch | `cursor/goldmeta-v5-3-ui-redesign-c2c2` |
| Draft PR | https://github.com/saviosyl/GOLDSMETA/pull/14 |
| Preview alias | https://preview-v5-3.goldmeta-web.pages.dev (https://426c446f.goldmeta-web.pages.dev) |
| UI review shell (no passwords) | `/ui-review/` on `*.pages.dev` / localhost |
| Empty / offline review | `/ui-review/?empty=1` · `/ui-review/intelligence?offline=1` |

## Sign-in redesign

- Option A: left brand panel + right card (~440px) on desktop ≥1100px
- “Welcome back” / “Sign in to continue to GoldMeta.”
- Show/hide password, Forgot password?, secondary “Create an account” text link
- Removed Firebase/iOS/backend/Brand-preview customer copy
- Control height ~50px

## Brand concepts

- **A/B/C withdrawn**
- **D** Interlocked GM · **E** Wordmark + companion · **F** Market-structure monogram
- Rebuilt `/brand` with three equal desktop columns and readable previews (180 / 32 / 16 / mono / iPhone)

## Tokens (calmer gold)

| Token | Value |
|---|---|
| bg | `#0B0E13` |
| surface | `#131820` |
| elevated | `#19202A` |
| text | `#F2F5F8` |
| secondary | `#A5AFBC` |
| muted | `#737F8D` |
| gold | `#C8A44D` |
| input | `#0E1218` |
| border | `rgba(255,255,255,0.09)` |

## Production unchanged

| Item | Value |
|---|---|
| Scroll hotfix commit | `198825d` |
| Scroll deploy | `efd89e79-8890-4bd2-9747-f6791cedda54` |
| Broker | DISABLED |
| V3 / V4 | Unchanged / SHADOW-only |

## Tests

- Backend 149 · Web 88+ · Playwright viewport matrix + scroll
- Desktop auth width ≥1280: layout full width, card ~440px, brand panel visible
- Mobile 390: full-width card, no brand panel, bottom nav on review shell

Stop for Savio approval. Do not merge. Do not promote.
