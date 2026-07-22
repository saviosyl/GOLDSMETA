# GoldMeta V5.2 — Deploy new UI & complete branding

**Date:** 2026-07-21  
**Draft PR:** https://github.com/saviosyl/GOLDSMETA/pull/12  
**Branch:** `cursor/goldmeta-v5-intelligence-c2c2`  
**Deployed frontend commit:** _(filled after production deploy)_  

## Preview

| Item | Value |
| --- | --- |
| Preview alias | https://preview-v5-2.goldmeta-web.pages.dev |
| Latest preview deployment | see Cloudflare dashboard / wrangler list |
| Pages project | `goldmeta-web` |
| Method | Wrangler `pages deploy` (no second project; no DNS changes) |

## Production

| Item | Value |
| --- | --- |
| URL | https://goldmeta.metamechsolutions.com |
| Production branch | `cursor/production-connection` |
| Deployment ID | _(filled after promote)_ |

## Branding

- Premium original **GM** monogram on charcoal with metallic gold accent and subtle ascending chart geometry
- Horizontal wordmark: GoldMeta + “Gold Market Intelligence”
- Assets: favicon.ico/16/32, apple-touch-icon 180, pwa 192/512, maskable 192/512, SVG mark/logo/mono
- Manifest name: **GoldMeta — Gold Market Intelligence** / short_name **GoldMeta**
- iOS meta: apple-mobile-web-app-capable, status-bar-style, title GoldMeta, theme-color `#0A0B0D`

## SPA routing note

Site-wide `404.html` prevented Cloudflare Pages SPA `_redirects` from rewriting client routes. Removed. `_redirects` is now only:

```text
/*    /index.html   200
```

## iPhone PWA refresh (after production)

1. Remove the existing GoldMeta home-screen app.  
2. Open https://goldmeta.metamechsolutions.com in Safari.  
3. Refresh the page.  
4. Share → Add to Home Screen.  

## Safety

- Broker DISABLED · V4 SHADOW · V3 unchanged · ios/ untouched · PR not auto-merged  
- Token used only via environment for Wrangler; never committed  
