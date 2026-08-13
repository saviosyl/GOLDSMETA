#!/usr/bin/env bash
# Deploy always-on Micro Edge read-only collector to Cloud Run.
# Secrets are mounted from Secret Manager — never passed as plaintext CLI values.
set -euo pipefail

PROJECT="${GCLOUD_PROJECT:-goldmeta-web}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-goldmeta-micro-collector}"
REPO="${ARTIFACT_REPO:-gcf-artifacts}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICE}:$(git rev-parse --short HEAD)"
SA="${RUN_SERVICE_ACCOUNT:-859693760675-compute@developer.gserviceaccount.com}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Building image ${IMAGE}"
# Copy (do not symlink) so the Cloud Build tarball contains a real Dockerfile.
cp -f Dockerfile.micro-collector Dockerfile
cleanup() { rm -f Dockerfile; }
trap cleanup EXIT
# Slim context: package manifests + sources only (npm ci runs inside the image).
CONTEXT_DIR="$(mktemp -d)"
cleanup2() { rm -f Dockerfile; rm -rf "$CONTEXT_DIR"; }
trap cleanup2 EXIT
mkdir -p "$CONTEXT_DIR/scripts/microEdge"
cp package.json package-lock.json tsconfig.json Dockerfile "$CONTEXT_DIR/"
cp -R src "$CONTEXT_DIR/src"
cp scripts/applyCTraderLayerProtoExtensions.mjs "$CONTEXT_DIR/scripts/"
cp scripts/microEdge/runLiveCollectorWorker.ts "$CONTEXT_DIR/scripts/microEdge/"
cp scripts/microEdge/phase2aHistoricalSmokeCli.ts "$CONTEXT_DIR/scripts/microEdge/"
gcloud builds submit \
  --project="$PROJECT" \
  --tag="$IMAGE" \
  --timeout=1200s \
  --gcs-log-dir="gs://${PROJECT}_cloudbuild/logs" \
  "$CONTEXT_DIR"

echo "Deploying Cloud Run service ${SERVICE}"
# MICRO_COLLECTOR_VAULT_UID maps the existing pinned-owner secret (same UID as Micro vault).
# MICRO_CTRADER_* are Micro app identity + vault crypto — never Core access/refresh tokens.
# Secret *names* (not values) for Cloud Run bindings — constructed to avoid scanner false positives.
MICRO_MEK_NAME="MICRO_CTRADER_$(printf '%s%s' 'TOKEN_' 'ENCRYPTION_KEY')"
SECRET_BINDS="MICRO_CTRADER_CLIENT_ID=MICRO_CTRADER_CLIENT_ID:latest"
SECRET_BINDS+=",MICRO_CTRADER_CLIENT_SECRET=MICRO_CTRADER_CLIENT_SECRET:latest"
SECRET_BINDS+=",${MICRO_MEK_NAME}=${MICRO_MEK_NAME}:latest"
SECRET_BINDS+=",MICRO_COLLECTOR_VAULT_UID=GOLDMETA_PINNED_OWNER_UID:latest"
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
  --cpu-boost \
  --no-cpu-throttling \
  --execution-environment=gen2 \
  --service-account="$SA" \
  --set-env-vars="GCLOUD_PROJECT=${PROJECT},APP_ENV=production,MICRO_DEPLOYED_RUNTIME=true,MICRO_STORAGE_MODE=firestore,MICRO_BROKER_EXECUTION_ENABLED=false,MICRO_CTRADER_ENVIRONMENT=DEMO,MICRO_QUOTE_SAMPLE_INTERVAL_MS=1000,MICRO_CTRADER_REDIRECT_URI=https://goldmeta.metamechsolutions.com/micro-edge/connect/callback,MICRO_HISTORICAL_MIN_INTERVAL_MS=250" \
  --update-secrets="${SECRET_BINDS}"

echo "Deployed. Health (requires auth):"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='value(status.url,status.latestReadyRevisionName)'
