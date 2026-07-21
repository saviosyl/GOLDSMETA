# Cloudflare Pages — GoldMeta V5.1 deployment audit

**Production URL:** https://goldmeta.metamechsolutions.com  
**Pages project:** `goldmeta-web` (existing — do **not** create a second project)  
**Also:** `goldmeta-web.pages.dev`  
**Repo root for Pages:** `web`  
**Build:** `npm ci && npm run build` → output `dist`  
**SPA:** `web/public/_redirects` → `/* /index.html 200`

## Deployment method (existing)

GoldMeta uses **Cloudflare Pages** with either:

1. **Git-connected Pages** (preferred when linked in the Cloudflare dashboard), or  
2. **Wrangler CLI direct upload** (`npx wrangler pages deploy dist --project-name goldmeta-web`)

Do **not** modify DNS, unrelated Workers, MetaMech marketing sites, or custom domains outside `goldmeta.metamechsolutions.com`.

## Secrets required (values never committed / logged)

| Secret name | Where | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret **and/or** agent/CI env | Authenticate Pages deploy via Wrangler/API |
| `CLOUDFLARE_ACCOUNT_ID` | Already available in this environment | Target Cloudflare account |

### Minimum Cloudflare API token permissions

Create a token at Cloudflare → My Profile → API Tokens → Create Token:

- **Account → Cloudflare Pages → Edit**
- **Account → Account Settings → Read** (optional, for account listing)
- Include only the GoldMeta account resource

Do **not** grant Zone DNS edit, Workers Scripts edit for unrelated projects, or User API Credentials.

### Manual steps for Savio (secure)

1. Cloudflare Dashboard → My Profile → API Tokens → Create Token with Pages Edit (above).  
2. Copy the token **once** — do not paste into chat, source, PR comments, or local `.env` committed files.  
3. GitHub → `saviosyl/GOLDSMETA` → Settings → Secrets and variables → Actions → New repository secret:  
   - Name: **`CLOUDFLARE_API_TOKEN`**  
   - Value: paste token  
4. Optionally add the same secret to the Cursor cloud environment (encrypted env), never into the repo.  
5. Re-run the V5.1 agent / workflow so preview then production Pages deploy can proceed.  
6. Prefer **preview deployment of PR #12 first**; promote only after smoke checks pass.

## Preview vs production

If Git-connected Pages is already wired to this repo:

- Open Cloudflare → Pages → `goldmeta-web` → deployments for branch `cursor/goldmeta-v5-intelligence-c2c2`  
- Use the preview URL for verification before promoting production  

If only Wrangler is available and `CLOUDFLARE_API_TOKEN` is set:

```bash
cd web
npm ci
npm run build
npx wrangler pages deploy dist --project-name goldmeta-web --branch preview-v5
# After verification:
npx wrangler pages deploy dist --project-name goldmeta-web --branch production
```

## Current blocker (V5.1 agent environment)

- `CLOUDFLARE_ACCOUNT_ID` — **present**  
- `CLOUDFLARE_API_TOKEN` — **missing**  

**Stop before deployment** until the secret is added securely. Do not invent a second Pages project or change DNS as a workaround.

## Production frontend configuration (verified in build)

`web/.env.production.local` must point only at:

```text
VITE_API_BASE_URL=https://us-central1-goldmeta-web.cloudfunctions.net/api
```

Firebase **web** config keys are client-side by design. Never bundle Firebase Admin, Cloudflare tokens, or backend secrets.
