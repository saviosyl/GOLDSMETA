# GoldMeta V6 — IG Demo secure credential setup

**Never** put IG credentials in GitHub, source control, React, Vite env, Firestore
client documents, coding-agent chat, or logs.

## Firebase Secret Manager names

| Secret name | Purpose |
|-------------|---------|
| `IG_DEMO_API_KEY` | IG Demo REST API key |
| `IG_DEMO_USERNAME` | IG Demo username / identifier |
| `IG_DEMO_PASSWORD` | IG Demo password |
| `IG_DEMO_ACCOUNT_ID` | Optional preferred Demo account id |

LIVE secrets (scaffolded names only — **do not enable** this release):

| Secret name | Purpose |
|-------------|---------|
| `IG_LIVE_API_KEY` | Reserved |
| `IG_LIVE_USERNAME` | Reserved |
| `IG_LIVE_PASSWORD` | Reserved |
| `IG_LIVE_ACCOUNT_ID` | Reserved |

Runtime flag:

| Env / param | Value |
|-------------|-------|
| `AUTOTRADE_BROKER` | `ig_demo` (production/preview with secrets) or `fake` (local/test) |
| `LIVE_EXECUTION_FEATURE_FLAG` | hard-coded `false` in source |
| `DEMO_ORDER_SUBMISSION_ENABLED` | hard-coded `false` (read-only Demo hardening) |

## Setup commands (operator machine only)

```bash
# From backend/ with Firebase CLI authenticated to the GoldMeta project
firebase functions:secrets:set IG_DEMO_API_KEY
firebase functions:secrets:set IG_DEMO_USERNAME
firebase functions:secrets:set IG_DEMO_PASSWORD
firebase functions:secrets:set IG_DEMO_ACCOUNT_ID

# Bind secrets on the HTTPS + decision trigger functions (firebase.json / code)
# then redeploy Functions only after Savio confirms — not part of this preview web deploy.
```

Wire secrets into Cloud Functions definitions before enabling Demo connectivity in a
deployed Functions environment. Until secrets exist, Demo connect **fails closed**.

## Redaction

CST, X-SECURITY-TOKEN, passwords, API keys, and full account ids are redacted by
`redactSecrets` before audit/activity logging. Never log session headers.
