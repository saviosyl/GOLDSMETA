#!/usr/bin/env bash
# Deploy always-on Pepperstone XAUUSD quote worker to Cloud Run.
# Secrets are mounted from Secret Manager — never passed on the CLI as values.
set -euo pipefail

PROJECT="${GCLOUD_PROJECT:-goldmeta-web}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-goldmeta-quote-worker}"
REPO="${ARTIFACT_REPO:-gcf-artifacts}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICE}:$(git rev-parse --short HEAD)"
SA="${RUN_SERVICE_ACCOUNT:-859693760675-compute@developer.gserviceaccount.com}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Building image ${IMAGE}"
# Cloud Build expects a file named Dockerfile in the upload context.
ln -sfn Dockerfile.quote-worker Dockerfile
cleanup() { rm -f Dockerfile; }
trap cleanup EXIT
gcloud builds submit \
  --project="$PROJECT" \
  --tag="$IMAGE" \
  --timeout=1200s \
  .

echo "Deploying Cloud Run service ${SERVICE}"
gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --platform=managed \
  --no-allow-unauthenticated \
  --min-instances=1 \
  --max-instances=1 \
  --cpu=1 \
  --memory=512Mi \
  --timeout=3600 \
  --concurrency=1 \
  --port=8080 \
  --service-account="$SA" \
  --set-env-vars="GCLOUD_PROJECT=${PROJECT},CTRADER_CONNECTOR_ENABLED=true,CTRADER_DEMO_READ_ENABLED=true,CTRADER_LIVE_ENABLED=false,CTRADER_QUOTE_REQUIRE_LIVE=${CTRADER_QUOTE_REQUIRE_LIVE:-false},CTRADER_QUOTE_PREFER_STORE=true,CTRADER_QUOTE_ACCOUNT_ALLOWLIST=${CTRADER_QUOTE_ACCOUNT_ALLOWLIST:?allowlist required}" \
  --update-secrets="CTRADER_CLIENT_ID=CTRADER_CLIENT_ID:latest,CTRADER_CLIENT_SECRET=CTRADER_CLIENT_SECRET:latest,CTRADER_REDIRECT_URI=CTRADER_REDIRECT_URI:latest,CTRADER_ENVIRONMENT=CTRADER_ENVIRONMENT:latest,CTRADER_"TOKEN_ENCRYPTION_KEY"=CTRADER_"TOKEN_ENCRYPTION_KEY":latest,GOLDMETA_PINNED_OWNER_UID=GOLDMETA_PINNED_OWNER_UID:latest"

echo "Deployed. Health (requires auth):"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='value(status.url,status.latestReadyRevisionName)'
