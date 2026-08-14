#!/usr/bin/env bash
# Deploy isolated GOLD_HUNTER FAST continuous research collector to Cloud Run.
# RESEARCH CAPTURE ONLY — MICRO_BROKER_EXECUTION_ENABLED=false — no Demo/Live orders.
# campaignMode=true — explicit research GCS bucket — prefix research-capture/ only.
# Secrets mount from Secret Manager — never print secret values.
set -euo pipefail

PROJECT="${GCLOUD_PROJECT:?GCLOUD_PROJECT required}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-gold-hunter-fast-research-collector}"
REPO="${ARTIFACT_REPO:-gcf-artifacts}"
DEPLOY_SHA="${DEPLOY_GIT_SHA:-$(git rev-parse HEAD)}"
IMAGE_TAG="${DEPLOY_SHA}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICE}:${IMAGE_TAG}"
SA="${RUN_SERVICE_ACCOUNT:-859693760675-compute@developer.gserviceaccount.com}"
# Explicit research bucket — do not silently fall back.
GCS_BUCKET="${GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET:-${PROJECT}-gold-hunter-fast}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Deploy image SHA: ${DEPLOY_SHA}"
echo "Building image ${IMAGE}"
echo "Research GCS bucket: gs://${GCS_BUCKET}"
echo "Storage prefix: gold-hunter-fast/research-capture/"

# Copy (do not symlink) so Cloud Build tarball contains a real Dockerfile.
cp -f Dockerfile.gold-hunter-fast-research Dockerfile
CONTEXT_DIR="$(mktemp -d)"
cleanup() { rm -f Dockerfile; rm -rf "$CONTEXT_DIR"; }
trap cleanup EXIT
mkdir -p "$CONTEXT_DIR/scripts/microEdge"
cp package.json package-lock.json tsconfig.json Dockerfile "$CONTEXT_DIR/"
cp -R src "$CONTEXT_DIR/src"
cp scripts/applyCTraderLayerProtoExtensions.mjs "$CONTEXT_DIR/scripts/"
cp scripts/microEdge/runFastResearchCaptureRuntime.ts "$CONTEXT_DIR/scripts/microEdge/"

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
ENV_VARS+=",GOLD_HUNTER_FAST_SHADOW_ENABLED=false"
ENV_VARS+=",GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET=${GCS_BUCKET}"
ENV_VARS+=",GOLD_HUNTER_FAST_DEPLOY_GIT_SHA=${DEPLOY_SHA}"
# Preserve continuous Day-1 calendar origin across redeploys (do not wipe GCS).
ENV_VARS+=",GOLD_HUNTER_FAST_CAMPAIGN_START_DATE=${GOLD_HUNTER_FAST_CAMPAIGN_START_DATE:-2026-08-14}"
ENV_VARS+=",MICRO_CTRADER_REDIRECT_URI=https://goldmeta.metamechsolutions.com/micro-edge/connect/callback"
ENV_VARS+=",MICRO_HISTORICAL_MIN_INTERVAL_MS=250"

# Health is research metrics only (no secrets). Allow unauthenticated health poll
# for campaign observability without enabling any trading surface.
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
