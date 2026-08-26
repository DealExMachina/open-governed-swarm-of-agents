#!/usr/bin/env bash
# Create Koyeb app sgrs-demo with private infra services.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "${KOYEB_ENV_FILE:-$ROOT/scripts/koyeb/env.local}"

: "${KOYEB_APP_NAME:?Set KOYEB_APP_NAME}"
: "${KOYEB_REGION:?Set KOYEB_REGION}"
: "${SWARM_FEED_IMAGE:?Set SWARM_FEED_IMAGE}"
: "${SWARM_HATCHERY_IMAGE:?Set SWARM_HATCHERY_IMAGE}"
: "${DATABASE_URL:?Set DATABASE_URL}"
: "${NATS_URL:?Set NATS_URL}"
: "${S3_ENDPOINT:?Set S3_ENDPOINT}"
: "${S3_ACCESS_KEY:?Set S3_ACCESS_KEY}"
: "${S3_SECRET_KEY:?Set S3_SECRET_KEY}"
: "${SWARM_API_TOKEN:?Set SWARM_API_TOKEN}"
: "${OPENAI_API_KEY:?Set OPENAI_API_KEY}"

echo "[koyeb] Ensuring app ${KOYEB_APP_NAME} in ${KOYEB_REGION}…"
koyeb app create "$KOYEB_APP_NAME" --region "$KOYEB_REGION" 2>/dev/null || true

echo "[koyeb] NATS (JetStream + volume)…"
koyeb service create "$KOYEB_APP_NAME/nats" \
  --instance-type nano \
  --regions "$KOYEB_REGION" \
  --docker "nats:2-alpine" \
  --docker-args "-js,-sd,/data,-m,8222" \
  --port 4222:http \
  --port 8222:http \
  --volume nats-data:/data \
  --checks 8222:http:/healthz \
  2>/dev/null || echo "  (nats may already exist)"

echo "[koyeb] MinIO…"
koyeb service create "$KOYEB_APP_NAME/minio" \
  --instance-type nano \
  --regions "$KOYEB_REGION" \
  --docker "minio/minio:latest" \
  --docker-args "server,/data,--console-address,:9001" \
  --port 9000:http \
  --env "MINIO_ROOT_USER=${S3_ACCESS_KEY}" \
  --env "MINIO_ROOT_PASSWORD=${S3_SECRET_KEY}" \
  --volume minio-data:/data \
  --checks 9000:http:/minio/health/live \
  2>/dev/null || echo "  (minio may already exist)"

echo "[koyeb] facts-worker…"
koyeb service create "$KOYEB_APP_NAME/facts-worker" \
  --instance-type eco-small \
  --regions "$KOYEB_REGION" \
  --docker "$FACTS_WORKER_IMAGE" \
  --port 8010:http \
  --env "OPENAI_API_KEY=${OPENAI_API_KEY}" \
  --checks 8010:http:/health \
  2>/dev/null || echo "  (facts-worker may already exist)"

echo "[koyeb] feed (private)…"
koyeb service create "$KOYEB_APP_NAME/feed" \
  --instance-type small \
  --regions "$KOYEB_REGION" \
  --docker "$SWARM_FEED_IMAGE" \
  --port 3002:http \
  --env "DATABASE_URL=${DATABASE_URL}" \
  --env "NATS_URL=${NATS_URL}" \
  --env "S3_ENDPOINT=${S3_ENDPOINT}" \
  --env "S3_ACCESS_KEY=${S3_ACCESS_KEY}" \
  --env "S3_SECRET_KEY=${S3_SECRET_KEY}" \
  --env "S3_BUCKET=${S3_BUCKET:-swarm}" \
  --env "FACTS_WORKER_URL=http://facts-worker:8010" \
  --env "OPENAI_API_KEY=${OPENAI_API_KEY}" \
  --env "SWARM_API_TOKEN=${SWARM_API_TOKEN}" \
  --env "FEED_HOST=0.0.0.0" \
  --checks 3002:http:/health \
  2>/dev/null || echo "  (feed may already exist)"

echo "[koyeb] hatchery…"
koyeb service create "$KOYEB_APP_NAME/hatchery" \
  --instance-type small \
  --regions "$KOYEB_REGION" \
  --docker "$SWARM_HATCHERY_IMAGE" \
  --env "DATABASE_URL=${DATABASE_URL}" \
  --env "NATS_URL=${NATS_URL}" \
  --env "S3_ENDPOINT=${S3_ENDPOINT}" \
  --env "S3_ACCESS_KEY=${S3_ACCESS_KEY}" \
  --env "S3_SECRET_KEY=${S3_SECRET_KEY}" \
  --env "S3_BUCKET=${S3_BUCKET:-swarm}" \
  --env "FACTS_WORKER_URL=http://facts-worker:8010" \
  --env "OPENAI_API_KEY=${OPENAI_API_KEY}" \
  --env "AGENT_ROLE=hatchery" \
  2>/dev/null || echo "  (hatchery may already exist)"

echo "[koyeb] Infra provisioned. Run deploy-public.sh after product images are ready."
