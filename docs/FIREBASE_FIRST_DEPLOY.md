# Firebase first configuration and phased deployment

Use this checklist before putting real values anywhere. **Do not invent a project ID.** Use the ID shown in Firebase Console.

GoldMeta supports a temporary **phased** rollout:

1. Configure Firebase Auth + Web SDK values  
2. Deploy / run the **web** app  
3. Deploy / point the **backend API** separately  
4. Enable **Web Push (VAPID)** later  

Web Push is optional. The app runs without VAPID keys; Settings → Enable Web Push returns a clear “not configured yet” message.

---

## 1. Values you must obtain from Firebase

| Value | Where in Firebase Console | Required for |
| --- | --- | --- |
| **API key** (`apiKey`) | Project settings → Your apps → Web app → SDK setup | Web Auth SDK |
| **Auth domain** (`authDomain`) | Same Web app config (usually `YOUR_PROJECT_ID.firebaseapp.com`) | Web Auth |
| **Project ID** (`projectId`) | Project settings → General | Web, Hosting, Functions, `.firebaserc` |
| **Storage bucket** (`storageBucket`) | Web app config (often `YOUR_PROJECT_ID.appspot.com`) | Web SDK (optional but recommended) |
| **Messaging sender ID** (`messagingSenderId`) | Web app config | Web SDK (optional for Auth-only; keep for later FCM/web) |
| **Firebase App ID** (`appId`) | Web app config (`1:…:web:…`) | Web Auth SDK |
| **Backend API URL** | After Functions deploy: `https://REGION-PROJECT_ID.cloudfunctions.net/api` | Web → backend |
| **VAPID public key** | Generated locally (`npx web-push generate-vapid-keys`), not from Console | Web Push (phase 3) |
| **VAPID private key** | Same local generation — **server only** | Web Push (phase 3) |
| **VAPID subject** | You choose (e.g. `mailto:you@example.com`) | Web Push (phase 3) |

Also configure in Console (no env var, but required for a test user):

| Console action | Why |
| --- | --- |
| Authentication → Sign-in method → **Email/Password** → Enable | Web sign-in / sign-up |
| Authentication → Settings → **Authorized domains** | Add your Hosting domain (and `localhost` for local) |
| Authentication → Users → Add user **or** use in-app Sign up | First test account |
| Hosting → Get started (if not already) | Web deploy target |
| Firestore → Create database (production or test mode with locked rules later) | Backend storage when `STORAGE_BACKEND=firestore` |

---

## 2. Where each value goes

### `web/.env.local` (never commit)

```bash
VITE_API_BASE_URL=
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_STORAGE_BUCKET=
```

| Variable | Source |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase Web `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Web `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Web `projectId` |
| `VITE_FIREBASE_APP_ID` | Firebase Web `appId` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Web `messagingSenderId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Web `storageBucket` |
| `VITE_API_BASE_URL` | Your Functions URL ending in `/api`, or `http://127.0.0.1:8080` for local backend |

There is **no** VAPID key in the web env. The client fetches the public key from `GET /v1/push/vapid-public-key` after sign-in.

### Backend environment (`backend/.env` locally, or Functions secrets / env in production)

Minimum for Auth + API (phases 1–2):

```bash
NODE_ENV=production
APP_ENV=production
STORAGE_BACKEND=firestore
ALLOW_TEST_AUTH_HEADER=false
FIREBASE_PROJECT_ID=          # same project ID as web
FIREBASE_REGION=us-central1
WEBHOOK_PUBLIC_BASE_URL=      # https://REGION-PROJECT_ID.cloudfunctions.net/api
PAYLOAD_SIZE_LIMIT=128kb
AI_ENABLED=false
```

Optional later:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
AI_MAX_CALLS_PER_HOUR=20
BROKER_SECRETS_ENCRYPTION_KEY=
```

Web Push later (phase 3) — **never** put these in `web/`:

```bash
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
```

Local Functions also need Application Default Credentials (ADC), e.g. `gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service account JSON **outside the repo**.

### `.firebaserc` (repo root)

Replace the placeholder with your **real** project ID (from Console only):

```json
{
  "projects": {
    "default": "YOUR_REAL_FIREBASE_PROJECT_ID"
  }
}
```

Do not invent this string. Hosting deploys use the **root** `firebase.json` (Hosting → `web/dist`). Functions/Firestore use **`backend/firebase.json`** when you deploy from `backend/`.

### GitHub Actions secrets

**None required** for current CI:

- Web workflow uses safe dummy `VITE_*` values for lint/test/build only  
- Backend workflow uses `APP_ENV=test` + memory storage  

Do **not** put VAPID private keys, Firebase Admin JSON, or OpenAI keys in GitHub until you deliberately add a deploy workflow that needs them.

### Firebase Hosting / Functions configuration

| Piece | File / location |
| --- | --- |
| Hosting public dir + SPA rewrite | Root `firebase.json` → `web/dist` |
| Functions + Firestore | `backend/firebase.json` |
| Project binding | Root `.firebaserc` (and `--project` if deploying from `backend/`) |

---

## 3. Exact Firebase Console steps

1. Open [Firebase Console](https://console.firebase.google.com/) and select (or create) **your** project. Copy the **Project ID** exactly.  
2. Project settings → **Add app** → **Web** (if no Web app yet). Register “GoldMeta Web”.  
3. Copy the Firebase web config fields listed above into `web/.env.local`.  
4. **Authentication** → Sign-in method → enable **Email/Password**.  
5. **Authentication** → Users → **Add user** (email + password) **or** plan to use the app’s Sign up screen once.  
6. **Authentication** → Settings → Authorized domains → ensure `localhost` exists; after Hosting deploy, add your Hosting domain.  
7. **Firestore Database** → Create database (choose a region; lock rules for production as you go live).  
8. **Hosting** → Get started (skip until you have `web/dist`).  
9. Leave Web Push / VAPID until phase 3.

---

## 4. Exact `web/.env.local` template

```bash
# web/.env.local — never commit

# Phase 1 local: point at local backend OR leave until Functions URL exists
VITE_API_BASE_URL=http://127.0.0.1:8080

# From Firebase Console → Project settings → Your apps → Web app
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_STORAGE_BUCKET=
```

After Functions are live, change only:

```bash
VITE_API_BASE_URL=https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/api
```

(Use your real region if not `us-central1`.)

Rebuild the web app after changing env vars (`npm run build`) before Hosting deploy.

---

## 5. Exact backend environment template

```bash
# backend/.env — never commit

NODE_ENV=production
APP_ENV=production
PORT=8080
STORAGE_BACKEND=firestore
ALLOW_TEST_AUTH_HEADER=false

FIREBASE_PROJECT_ID=
FIREBASE_REGION=us-central1
WEBHOOK_PUBLIC_BASE_URL=https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/api

WEBHOOK_MAX_SKEW_MS=300000
WEBHOOK_RATE_LIMIT_WINDOW_MS=60000
WEBHOOK_RATE_LIMIT_MAX=60
PAYLOAD_SIZE_LIMIT=128kb

AI_ENABLED=false
# OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
AI_MAX_CALLS_PER_HOUR=20

# Optional until you store broker secrets
# BROKER_SECRETS_ENCRYPTION_KEY=

# Phase 3 only — leave empty until you enable Web Push
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
```

---

## 6. Exact local commands

```bash
# --- Web ---
cd web
cp .env.example .env.local
# edit .env.local with real Firebase Web values
npm ci
npm run lint && npm run typecheck && npm test
npm run dev
# open http://127.0.0.1:5173

# --- Backend (optional same day) ---
cd ../backend
cp .env.example .env
# edit .env with real FIREBASE_PROJECT_ID (and ADC credentials)
npm ci
npm test
npm run build
npm run dev
# health: curl http://127.0.0.1:8080/health
```

---

## 7. Exact deployment commands (phased)

### Phase A — Web Hosting only

```bash
cd web
# ensure .env.local has production VITE_* including the API URL you will use
# (API can still be a temporary URL; dashboard will error until backend is up)
npm run build

cd ..
# set .firebaserc default to YOUR real project ID first
firebase login
firebase use   # confirm project
firebase deploy --only hosting --config firebase.json
```

### Phase B — Backend Functions separately

```bash
cd backend
npm ci
npm run build
firebase deploy --only functions,firestore --project YOUR_REAL_FIREBASE_PROJECT_ID
```

Then set `WEBHOOK_PUBLIC_BASE_URL` and `VITE_API_BASE_URL` to  
`https://REGION-PROJECT_ID.cloudfunctions.net/api`, rebuild web, redeploy Hosting if the API URL changed.

### Phase C — Web Push later

```bash
cd backend
npx web-push generate-vapid-keys
# put public/private into backend env / Functions secrets; set VAPID_SUBJECT
# redeploy functions
# In the installed PWA: Settings → Enable Web Push
```

---

## 8. Exact first browser test

1. Open the Hosting URL (or `npm run dev` locally) in a desktop browser.  
2. Confirm Sign in / Sign up form appears (not “Firebase not configured”).  
3. Sign in with your first test user (or Sign up once).  
4. Confirm session sticks after refresh.  
5. Dashboard loads (may show “No decision yet” or an API error until backend has data — that is OK).  
6. Open Settings → Sign out → Sign in again.  
7. Settings → Enable Web Push **without** VAPID → expect message that server VAPID is not configured (safe).

---

## 9. Exact first iPhone Home Screen test

1. Deploy Hosting over **HTTPS** (required on device).  
2. iPhone Safari → open Hosting URL → Sign in.  
3. Share → **Add to Home Screen** → open the icon.  
4. Confirm standalone UI (minimal browser chrome) and still signed in.  
5. Load dashboard once online → enable Airplane Mode → reopen → expect **stale/offline** cached decision banner if a decision was cached.  
6. Do **not** treat push as verified until Phase C on a real device.

---

## 10. Safety checks (already in code)

| Check | Behaviour |
| --- | --- |
| Env names | Docs/templates match `VITE_FIREBASE_*`, `VITE_API_BASE_URL`, `VAPID_*`, `FIREBASE_PROJECT_ID` |
| Web Push unset | `GET /v1/push/vapid-public-key` returns `{ publicKey: null }`; client shows missing_vapid; no crash |
| Auth | Email/password sign-in + sign-up; Bearer ID token; no bypass |
| CI secrets | None required for current workflows |

---

## 11. Blockers (must resolve with your Firebase project)

1. **Real Project ID** must replace `.firebaserc` placeholder before Hosting deploy.  
2. **Email/Password** must be enabled or sign-in fails.  
3. **Authorized domains** must include Hosting domain after first deploy.  
4. **Split Firebase configs**: Hosting from repo root; Functions from `backend/` — use the same project ID.  
5. **Backend API URL** must be set in `VITE_API_BASE_URL` before the web app can load live decisions.  
6. **ADC / service account** required for Functions to verify ID tokens against your project.  
7. **VAPID** not a blocker for first Auth + Hosting + API test — enable later.
