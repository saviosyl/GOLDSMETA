# Cloudflare Pages deploy (GoldMeta PWA)

Production URL: **https://goldmeta.metamechsolutions.com**

The PWA frontend (`web/`) is hosted on **Cloudflare Pages**.  
Firebase remains Auth + Firestore + backend API only.  
Do **not** deploy the PWA with Firebase Hosting.  
Do **not** change https://metamechsolutions.com — GoldMeta is isolated on the subdomain.

`ios/` stays the future App Store app and is untouched.

---

## Cloudflare Pages settings

| Setting | Value |
| --- | --- |
| Project name | `goldmeta-web` (recommended) |
| Root directory | `web` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `20` |
| Production branch | `cursor/production-connection` or `main` (your choice) |
| Custom domain | `goldmeta.metamechsolutions.com` |

SPA routing is handled by `web/public/_redirects`:

```text
/*    /index.html   200
```

HTTPS uses Cloudflare’s managed SSL once the custom domain is attached and active.

---

## Environment variables (Cloudflare Pages → Settings → Environment variables)

Set these for **Production** (and Preview if you want preview Auth against the same Firebase project).  
Do **not** commit `web/.env.local`.

| Variable | Example / notes |
| --- | --- |
| `VITE_API_BASE_URL` | Your Firebase Functions URL ending in `/api` (or leave local-only until API is live) |
| `VITE_FIREBASE_API_KEY` | From Firebase Web config |
| `VITE_FIREBASE_AUTH_DOMAIN` | e.g. `goldmeta-web.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | e.g. `goldmeta-web` |
| `VITE_FIREBASE_APP_ID` | Firebase Web `appId` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Web sender ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |

No VAPID keys in Pages. Web Push uses backend `VAPID_*` only.

After changing env vars, trigger a new Pages deployment (env is baked in at Vite build time).

---

## Firebase Authorized Domains

In Firebase Console → Authentication → Settings → **Authorized domains**, add:

```text
goldmeta.metamechsolutions.com
```

Keep `localhost` for local dev. Do not remove other required domains.

---

## DNS (subdomain only)

In the Cloudflare DNS zone for `metamechsolutions.com` (or your DNS host if the zone is elsewhere):

1. Add a **CNAME** (or Cloudflare Pages “Custom domain” which creates it):
   - Name: `goldmeta`
   - Target: your Pages project hostname (e.g. `goldmeta-web.pages.dev`)
2. Proxy status: **Proxied** (orange cloud) so Cloudflare SSL applies
3. Leave `metamechsolutions.com` / `www` records for the existing site unchanged

SSL: Cloudflare Full (strict) once the certificate is issued for `goldmeta.metamechsolutions.com`.

---

## Deploy options

### A) Git-connected Pages (recommended)

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git  
2. Select `saviosyl/GOLDSMETA`  
3. Configure root `web`, build `npm run build`, output `dist`  
4. Add Production env vars above  
5. Deploy  
6. Custom domains → Add `goldmeta.metamechsolutions.com`

### B) Direct upload / Wrangler (after `wrangler login`)

```bash
cd web
npm ci
npm run build
npx wrangler pages project create goldmeta-web --production-branch cursor/production-connection
npx wrangler pages deploy dist --project-name goldmeta-web
npx wrangler pages domain add goldmeta.metamechsolutions.com --project-name goldmeta-web
```

Requires Cloudflare account authentication in this environment (`wrangler login` or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

---

## Local verify before deploy

```bash
cd web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
# confirm dist/_redirects and dist/index.html exist
```

---

## What stays on Firebase

- Authentication (same users as iOS)  
- Firestore  
- Cloud Functions API (`/api`)  
- Device / Web Push backend  
- TradingView webhooks  

Nothing backend moves to Cloudflare.
