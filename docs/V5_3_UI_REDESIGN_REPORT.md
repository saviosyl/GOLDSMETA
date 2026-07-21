# GoldMeta V5.3 — UI redesign + scrolling hotfix report

## Deployment rule

| Deliverable | Target | Status |
|---|---|---|
| Scrolling hotfix | Production | Already deployed |
| Full UI redesign | Cloudflare **preview only** | Deployed — awaiting Savio approval |

**Do not promote the redesigned UI to production until Savio explicitly approves the preview.**

---

## 1. Scrolling hotfix (production)

| Item | Value |
|---|---|
| Cause | `.app-shell { overflow-x: hidden }` created a dead Chromium scrollport that swallowed wheel events |
| Fix | Document (`html`) is the vertical scrollport; `#root` / `.app-shell` use `overflow: visible`; bottom padding under fixed nav; `ScrollToTop` on route change |
| Production commit | `198825d` (functional fix in `4288331`) |
| Production deployment ID | `efd89e79-8890-4bd2-9747-f6791cedda54` |
| Draft PR | https://github.com/saviosyl/GOLDSMETA/pull/13 |
| Mouse-wheel test | Pass (Playwright desktop + mobile) |
| Keyboard-scroll test | Pass (PageDown / End / Home / Space) |

---

## 2. UI redesign (preview only)

| Item | Value |
|---|---|
| Branch | `cursor/goldmeta-v5-3-ui-redesign-c2c2` |
| Commit | `4d7140f` |
| Draft PR | https://github.com/saviosyl/GOLDSMETA/pull/14 |
| Preview alias | https://preview-v5-3.goldmeta-web.pages.dev |
| Preview deployment | https://1703909c.goldmeta-web.pages.dev |
| Base | Built atop scroll hotfix tip (`198825d`), which includes V5.2 `b33be6a` |

### Design tokens

| Token | Value |
|---|---|
| `--bg` | `#0B0D10` |
| `--surface` | `#12161C` |
| `--elevated` | `#181D25` |
| `--text` | `#F4F7FA` |
| `--text-secondary` | `#9CA6B3` |
| `--muted` | `#717B87` |
| `--gold` | `#D1A84B` |
| `--gold-hover` | `#E0BA60` |
| `--positive` | `#3BCB7A` |
| `--warning` | `#E3A43A` |
| `--negative` | `#F06470` |

### Typography

- Family: Inter, ui-sans-serif, system-ui, …
- Page title 28px · Decision ~40px · Section 18px · Body 15px · Labels/meta 12–13px

### Navigation

**Desktop (≥1100px):** sticky left sidebar — Overview, Intelligence, Analytics, Replay, History, Journal, Risk planner, V4 Research, Settings, Brand preview.

**Mobile (<1100px):** bottom nav — Home, Intel, Analytics, Replay, More (History, Journal, Risk planner, V4, Settings, Brand).

### Logo concepts (production logo unchanged)

1. **A** — Geometric GM monogram (negative space)
2. **B** — GM + subtle market-structure line
3. **C** — Wordmark + small application mark

Review at: https://preview-v5-3.goldmeta-web.pages.dev/brand

### Screenshots

Saved under `/opt/cursor/artifacts/screenshots/`:

- `v53-desktop-1440-signin.png`
- `v53-mobile-390-signin.png`
- `v53-desktop-1440-brand.png` (after public `/brand` follow-up)
- `v53-mobile-390-brand.png`
- `v53-desktop-1440-scroll.png`
- `v53-mobile-390-scroll.png`

---

## 3. Tests

| Suite | Result |
|---|---|
| Backend lint | Pass |
| Backend build | Pass |
| Backend tests | **149** pass |
| Web lint | Pass |
| Web typecheck | Pass |
| Web unit tests | **82** pass |
| Production web build | Pass |
| Playwright (desktop + mobile) | **12** pass |
| Mouse-wheel | Pass |
| Keyboard scroll | Pass |
| Accessibility (focus-visible / reduced motion / contrast tokens) | Contracts in redesign CSS + unit coverage |
| Broker status | **DISABLED** |
| V3 regression | Unchanged algorithms / existing backend suite green |
| V4 regression | Remains SHADOW-only; existing suite green |

---

## 4. Remaining UI issues / follow-ups

- Authenticated Overview / Intelligence / Analytics / Replay screenshots require Savio sign-in on the preview (signed-out captures show the sign-in shell).
- Some legacy pages (History, Journal, V4 Research, Diagnostics) still use older `.card` chrome; softened via redesign overrides but not fully rewritten.
- Diagnostics still reachable by URL for non-admins (backend returns 403); not linked in primary sidebar.
- Visual regression snapshot library not yet wired into CI; screenshots attached for manual review.
- Production logo and favicon remain V5.2 until a concept is selected.

## 5. Explicit non-actions

- Redesign **not** merged
- Redesign **not** promoted to production
- Broker execution **not** enabled
- Trading algorithms **not** changed
- No profitability claims
