# GoldMeta Web PWA Setup

The Progressive Web App in `web/` is the primary browser client. The native `ios/` app remains the future App Store version. Both share the same backend APIs and Firebase project.

## Architecture

```text
backend/  shared Firebase Cloud Functions API + decision engine
web/      primary browser / Home Screen PWA
ios/      native backup / future App Store build
```

BUY / SELL / WAIT always come from the backend. The web app never scores trades locally.

## 1. Install dependencies

```bash
cd web
npm ci
```

## 2. Run locally

```bash
cp .env.example .env.local
# fill VITE_* values
npm run dev
```

Open the printed localhost URL (typically `http://127.0.0.1:5173`).

## 3. Configure Firebase Web SDK

In Firebase Console → Project settings → Your apps → Web app, copy the config into `web/.env.local`:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...   # same project as iOS + backend
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
```

Enable **Email/Password** authentication for that project (same as iOS).

There is **no auth bypass** in the web client.

## 4. Set the backend API URL

```bash
VITE_API_BASE_URL=https://REGION-PROJECT_ID.cloudfunctions.net/api
# local backend:
# VITE_API_BASE_URL=http://127.0.0.1:8080
```

Authenticated calls send `Authorization: Bearer <Firebase ID token>`.

## 5. Build for production

```bash
cd web
npm run lint
npm run typecheck
npm test
npm run build
```

Output is written to `web/dist/`.

## 6. Deploy to Cloudflare Pages (not Firebase Hosting)

Production frontend: **https://goldmeta.metamechsolutions.com**

Follow [CLOUDFLARE_PAGES_DEPLOY.md](CLOUDFLARE_PAGES_DEPLOY.md).

Summary:

- Project root: `web`
- Build: `npm run build`
- Output: `dist`
- SPA: `public/_redirects` → `/* /index.html 200`
- Env vars: set `VITE_*` in Cloudflare Pages (never commit `.env.local`)
- Firebase Hosting is **not** used for the PWA

Backend Auth / Firestore / Functions stay on Firebase.

For the ordered first-live checklist (Console steps, env templates, phased
web → API → Web Push), use [FIREBASE_FIRST_DEPLOY.md](FIREBASE_FIRST_DEPLOY.md)
and [CLOUDFLARE_PAGES_DEPLOY.md](CLOUDFLARE_PAGES_DEPLOY.md).

## Phased deployment mode

You can ship in three stages without architecture changes:

1. **Web first** — fill Cloudflare Pages `VITE_*` values, build `web/`, deploy Pages + custom domain.
2. **Backend separately** — deploy Functions from `backend/` with the same Firebase project ID; set `VITE_API_BASE_URL` and `WEBHOOK_PUBLIC_BASE_URL` to `…/api`.
3. **Web Push later** — set backend `VAPID_*` only; leave web env without VAPID. Until then, Enable Web Push shows that the server key is missing.

## 7. Open on iPhone

1. Deploy or tunnel a **HTTPS** origin (Safari requires HTTPS for installable PWAs except localhost).
2. Open the site in **Safari**.
3. Sign in with the same Firebase email/password used by iOS.

## 8. Add to Home Screen

1. Safari → Share → **Add to Home Screen**
2. Confirm the GoldMeta name/icon
3. Launch from the Home Screen icon (standalone display when supported)

The app does **not** install automatically.

## 9. Enable notifications

1. Prefer the Home Screen app on iPhone (Web Push is only reliable there on compatible iOS versions).
2. Settings → **Enable Web Push** (permission is requested only after this tap).
3. Backend must have VAPID keys configured:

```bash
# backend/.env — never expose the private key to the web client
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

Generate a key pair with `npx web-push generate-vapid-keys` on a trusted machine.

Web Push on iPhone should be treated as **unverified** until tested on a real device.

## 10. Test offline mode

1. Load the dashboard while online (caches last decision).
2. Enable airplane mode / DevTools offline.
3. Reload or reopen the Home Screen app.
4. Confirm the last decision appears with a **stale/offline** banner and generation time.
5. Restore connectivity and tap **Refresh**.

## 11. Test TEST alerts

1. Settings → Create TradingView connection (if needed).
2. Tap **Send TEST alert**.
3. Confirm the backend queues a TEST decision and the dashboard can refresh it.

## 12. Troubleshooting Safari / PWA

| Issue | Check |
| --- | --- |
| Cannot install | Must use Safari on iOS; HTTPS required |
| Push unavailable | Home Screen install + iOS version; VAPID configured |
| 401 loops | Firebase Auth users exist; API URL points at `/api` |
| Blank after deploy | Hosting rewrite to `index.html`; `web/dist` uploaded |
| Stale forever | Refresh action; network; backend health `/health` |

## Content Security Policy guidance

Prefer Firebase Hosting headers that:

- `default-src 'self'`
- `connect-src 'self'` your API origin + `https://*.googleapis.com` + `https://*.firebaseio.com`
- `script-src 'self'`
- `img-src 'self' data:`
- forbid embedding of Admin SDK / private keys

Do not log Firebase ID tokens.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc -b` |
| `npm test` | Vitest |
| `npm run build` | Production build + PWA assets |
