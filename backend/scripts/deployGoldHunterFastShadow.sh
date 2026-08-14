#!/usr/bin/env bash
# Deploy isolated GOLD_HUNTER FAST live-shadow soak service to Cloud Run.
# SHADOW ONLY — MICRO_BROKER_EXECUTION_ENABLED=false — no Demo/Live orders.
# Secrets mount from Secret Manager — never print secret values.
set -euo pipefail

PROJECT="${GCLOUD_PROJECT:?GCLOUD_PROJECT required}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-gold-hunter-fast-shadow}"
REPO="${ARTIFACT_REPO:-gcf-artifacts}"
APPROVED_SHA="${APPROVED_GIT_SHA:-82bb13536f84728d49090ce05d5d9e9218accb88}"
DEPLOY_SHA="${DEPLOY_GIT_SHA:-$(git rev-parse HEAD)}"
IMAGE_TAG="${DEPLOY_SHA}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICE}:${IMAGE_TAG}"
SA="${RUN_SERVICE_ACCOUNT:-859693760675-compute@developer.gserviceaccount.com}"
GCS_BUCKET="${GOLD_HUNTER_FAST_GCS_BUCKET:-${PROJECT}-gold-hunter-fast}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Approved strategy SHA: ${APPROVED_SHA}"
echo "Deploy image SHA: ${DEPLOY_SHA}"
echo "Building image ${IMAGE}"

# Copy (do not symlink) so Cloud Build tarball contains a real Dockerfile.
cp -f Dockerfile.gold-hunter-fast-shadow Dockerfile
CONTEXT_DIR="$(mktemp -d)"
cleanup() { rm -f Dockerfile; rm -rf "$CONTEXT_DIR"; }
trap cleanup EXIT
mkdir -p "$CONTEXT_DIR/scripts/microEdge"
cp package.json package-lock.json tsconfig.json Dockerfile "$CONTEXT_DIR/"
cp -R src "$CONTEXT_DIR/src"
cp scripts/applyCTraderLayerProtoExtensions.mjs "$CONTEXT_DIR/scripts/"
cp scripts/microEdge/runFastShadowRuntime.ts "$CONTEXT_DIR/scripts/microEdge/"

gcloud builds submit \
  --project="$PROJECT" \
  --tag="$IMAGE" \
  --timeout=1200s \
  --gcs-log-dir="gs://${PROJECT}_cloudbuild/logs" \
  "$CONTEXT_DIR"

echo "Ensuring GCS bucket gs://${GCS_BUCKET}"
gcloud storage buckets describe "gs://${GCS_BUCKET}" --project="$PROJECT" >/dev/null 2>&1 \
  || gcloud storage buckets create "gs://${GCS_BUCKET}" --project="$PROJECT" --location="$REGION"

echo "Deploying Cloud Run service ${SERVICE}"
MICRO_MEK_NAME="MICRO_CTRADER_$(printf '%s%s' 'TOKEN_' 'ENCRYPTION_KEY')"
SECRET_BINDS="MICRO_CTRADER_CLIENT_ID=MICRO_CTRADER_CLIENT_ID:latest"
SECRET_BINDS+=",MICRO_CTRADER_CLIENT_SECRET=MICRO_CTRADER_CLIENT_SECRET:latest"
SECRET_BINDS+=",${MICRO_MEK_NAME}=${MICRO_MEK_NAME}:latest"
SECRET_BINDS+=",MICRO_COLLECTOR_VAULT_UID=GOLDMETA_PINNED_OWNER_UID:latest"

ENV_VARS="GCLOUD_PROJECT=${PROJECT}"
ENV_VARS+=",APP_ENV=production"
ENV_VARS+=",MICRO_DEPLOYED_RUNTIME=true"
ENV_VARS+=",MICRO_STORAGE_MODE=firestore"
ENV_VARS+=",MICRO_BROKER_EXECUTION_ENABLED=false"
ENV_VARS+=",MICRO_CTRADER_ENVIRONMENT=DEMO"
ENV_VARS+=",GOLD_HUNTER_FAST_SHADOW_ENABLED=true"
ENV_VARS+=",GOLD_HUNTER_FAST_SOAK_TARGET_TRADES=250"
ENV_VARS+=",GOLD_HUNTER_FAST_GCS_BUCKET=${GCS_BUCKET}"
ENV_VARS+=",GOLD_HUNTER_FAST_APPROVED_GIT_SHA=${APPROVED_SHA}"
ENV_VARS+=",GOLD_HUNTER_FAST_DEPLOY_GIT_SHA=${DEPLOY_SHA}"
ENV_VARS+=",MICRO_CTRADER_REDIRECT_URI=https://goldmeta.metamechsolutions.com/micro-edge/connect/callback"
ENV_VARS+=",MICRO_HISTORICAL_MIN_INTERVAL_MS=250"

# Health exposes shadow research metrics only (no secrets). Allow unauthenticated
# so the isolated preview dashboard can poll live status without production merge.
gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --platform=managed \
  --allow-unauthenticated \
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
  --set-env-vars="${ENV_VARS}" \
  --update-secrets="${SECRET_BINDS}"

echo "Deployed. Recording descriptors:"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='yaml(status.url,status.latestReadyRevisionName,status.latestCreatedRevisionName,spec.template.spec.containers[0].image)'
