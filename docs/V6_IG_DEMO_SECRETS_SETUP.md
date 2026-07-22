# GoldMeta V6 — IG Demo read-only private setup (Savio)

**Never** paste IG credentials into GitHub, coding-agent chat, source files, React,
Vite variables, Firestore, Cloudflare browser variables, or logs.

This stage is **IG DEMO — READ ONLY**. Order submission stays disabled.

---

## 1. Create / find the IG Demo API key

1. Sign in to the **IG Demo** environment (not Live).
2. Open **My IG → Settings → API keys** (or IG Labs / developer portal for Demo).
3. Create an API key enabled for the **Demo** REST API.
4. Copy the key only into the Firebase CLI prompt below — nowhere else.

## 2. IG Demo username

Use the same **Demo username / identifier** you use to log into the IG Demo platform
(the account that owns the Demo API key).

## 3. Identify the Demo account ID

1. Log into IG Demo in a browser or via the API session.
2. Open account settings / account switcher and note the **account ID** string
   (not the masked display name).
3. Confirm it is the Demo CFD account you want AutoTrade to pin.
4. This value becomes `IG_DEMO_ACCOUNT_ID`. If it does not match the active account
   after connect, AutoTrade **locks** with **Account mismatch**.

## 4. Firebase Secret Manager commands (local terminal only)

From `backend/` with Firebase CLI authenticated to project `goldmeta-web`:

```bash
firebase functions:secrets:set IG_DEMO_API_KEY
firebase functions:secrets:set IG_DEMO_USERNAME
firebase functions:secrets:set IG_DEMO_PASSWORD
firebase functions:secrets:set IG_DEMO_ACCOUNT_ID
```

Each command prompts privately in the terminal. Do not echo values afterward.

Confirm secret names only (no values):

```bash
firebase functions:secrets:access IG_DEMO_API_KEY >/dev/null && echo "IG_DEMO_API_KEY is set"
```

(Or use `firebase functions:secrets:get` / console listing — never paste values into chat.)

## 5. Deploy the isolated preview function only

Do **not** redeploy production `api`.

```bash
cd backend
firebase deploy --only functions:apiV6Preview
```

Preview function URL (after deploy):

`https://us-central1-goldmeta-web.cloudfunctions.net/apiV6Preview`

The V6 Cloudflare preview frontend must use this URL as `VITE_API_BASE_URL` for
preview builds only. Production Cloudflare env continues to point at `/api`.

Runtime enforced on `apiV6Preview`:

| Setting | Value |
|---------|-------|
| `AUTOTRADE_BROKER` | `ig_demo` |
| `DEMO_ORDER_SUBMISSION_ENABLED` | `false` |
| `LIVE_EXECUTION_FEATURE_FLAG` | `false` |
| Firestore namespace | `users/{uid}/autoTradePreview/...` |

Secrets are bound **only** to `apiV6Preview` via `defineSecret`.

## 6. Remove or rotate secrets

Rotate (set a new value):

```bash
firebase functions:secrets:set IG_DEMO_API_KEY
firebase functions:secrets:set IG_DEMO_USERNAME
firebase functions:secrets:set IG_DEMO_PASSWORD
firebase functions:secrets:set IG_DEMO_ACCOUNT_ID
firebase deploy --only functions:apiV6Preview
```

Destroy a secret version (after creating a replacement):

```bash
# List versions in Google Cloud Secret Manager, then destroy old versions
# via Cloud Console → Secret Manager, or:
gcloud secrets versions destroy VERSION --secret=IG_DEMO_API_KEY --project=goldmeta-web
```

If Demo access must be revoked immediately: rotate the IG Demo API key in the IG
portal first, then update Firebase secrets and redeploy `apiV6Preview` only.

## Verification checklist (after secrets + deploy)

1. Open the V6 preview AutoTrade page.
2. Confirm banner: **IG DEMO — READ ONLY**.
3. Click **Connect IG Demo** / **Run read-only diagnostics**.
4. Confirm masked account, currency, balance, Spot Gold candidates / EPIC, quotes,
   stop rules, heartbeat, and open positions (read-only).
5. Confirm no order controls are enabled.
6. Confirm production site still uses V5.4.3 / production `api`.

Do not enable Demo order submission or LIVE execution until Savio approves a later stage.
