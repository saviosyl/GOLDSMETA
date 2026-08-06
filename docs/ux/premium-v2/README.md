# GoldMeta Premium UI V2

Hybrid navy + light design system matching the approved mockups.

## Design system

- **Palette:** deep navy (`--navy-950…800`) for sidebar / hero / level map; light surfaces (`--surface-page`, `--surface-card`) for content (~70–80% light); gold accents for active nav and PREPARE.
- **Typography:** Plus Jakarta Sans (400–800).
- **Icons:** Lucide React (Bell, Home, Globe2, BookOpen, etc.).
- **Spacing:** 4px/8px scale (`--space-1…8`).
- **Radii:** hero 22–28px, cards 16–20px, pills 999px.
- **Shadow:** `0 8px 24px rgba(9, 35, 69, 0.08)`.

## Shell

- Desktop: fixed navy sidebar + sticky top bar (quote, session, AutoTrade OFF, bell, avatar).
- Mobile: safe-area header, compact quote row, 5-item bottom nav (Plan / Markets / Journal / Alerts / More).

## Screenshots

Captured from `npm run build:ui-review` + Vite preview (`/ui-review`).

| Screen | Mobile 390 | Desktop 1440 |
|--------|------------|--------------|
| Plan | `home-plan-mobile-390.png` | `home-plan-desktop.png` |
| Levels | `levels-mobile-390.png` | `levels-desktop.png` |
| Alerts & Setup | `alerts-setup-mobile-390.png` | `alerts-setup-desktop.png` |
| Markets | `markets-mobile-390.png` | `markets-desktop.png` |
| Journal | `journal-mobile-390.png` | `journal-desktop.png` |
| Notification centre | `notifications-mobile-390.png` | — |

Also: `home-plan-mobile-320.png`, `home-plan-mobile-375.png`.

Artifacts mirror: `/opt/cursor/artifacts/premium-v2/`.

## Capture

```bash
cd web
npm run build:ui-review
npx vite preview --host 127.0.0.1 --port 4177 --strictPort
UI_REVIEW_BASE=http://127.0.0.1:4177/ui-review node scripts/capture-premium-ui-screenshots.mjs ../docs/ux/premium-v2
```

UI review defaults to ordinary `USER` role (webhook hidden). Use `?staff=1` for OWNER chrome.
