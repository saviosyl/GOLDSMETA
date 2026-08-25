# Checkpoint A blocked — Secret Manager IAM required

The five CTRADER_* secrets **exist** (Cloud Functions deploy resolved their names).
Deploy of `apiCTraderPreview` **failed** because the runtime service account cannot read them.

## Exact grants (run as GCP project Owner)

Runtime service account (required for serving):

```bash
PROJECT=goldmeta-web
RUNTIME_SA=859693760675-compute@developer.gserviceaccount.com
for S in CTRADER_CLIENT_ID CTRADER_CLIENT_SECRET CTRADER_REDIRECT_URI CTRADER_TOKEN_ENCRYPTION_KEY CTRADER_ENVIRONMENT; do
  gcloud secrets add-iam-policy-binding "$S" \
    --project="$PROJECT" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

Deployment agent (required so the agent can verify metadata + finish deploy):

```bash
DEPLOY_SA=goldmeta-deployment-agent@goldmeta-web.iam.gserviceaccount.com
for S in CTRADER_CLIENT_ID CTRADER_CLIENT_SECRET CTRADER_REDIRECT_URI CTRADER_TOKEN_ENCRYPTION_KEY CTRADER_ENVIRONMENT; do
  gcloud secrets add-iam-policy-binding "$S" \
    --project="$PROJECT" \
    --member="serviceAccount:${DEPLOY_SA}" \
    --role="roles/secretmanager.secretAccessor"
  gcloud secrets add-iam-policy-binding "$S" \
    --project="$PROJECT" \
    --member="serviceAccount:${DEPLOY_SA}" \
    --role="roles/secretmanager.viewer"
done
```

Do **not** grant project-wide Secret Manager Admin.

## After grants

Reply to the agent to continue Checkpoint A:
1. Verify secret metadata (ENVIRONMENT=DEMO, redirect URI exact)
2. Redeploy only `apiCTraderPreview`
3. Verify callback health
4. Tell you when to press **Connect cTrader** on the preview Brokers page

## Already done without secrets access

- Confirmed secrets exist (by name) via failed revision bind
- Fixed OAuth `scope=accounts` (was incorrectly `trading`) — pushed as `3c1ab8f`
- Preview CORS + OAuth return host prepared
- PR #43 remains DRAFT; production untouched
