#!/usr/bin/env bash
# Deploy public sgrs API + Studio; wire FEED_SERVER_URL to private feed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "${KOYEB_ENV_FILE:-$ROOT/scripts/koyeb/env.local}"

: "${KOYEB_APP_NAME:?Set KOYEB_APP_NAME}"
: "${KOYEB_REGION:?Set KOYEB_REGION}"
: "${SGRS_API_IMAGE:?Set SGRS_API_IMAGE}"
: "${SGRS_STUDIO_IMAGE:?Set SGRS_STUDIO_IMAGE}"
: "${SWARM_API_TOKEN:?Set SWARM_API_TOKEN}"
: "${ENCRYPTION_KEY:?Set ENCRYPTION_KEY}"
: "${API_KEY_PEPPER:?Set API_KEY_PEPPER}"
: "${CLERK_SECRET_KEY:?Set CLERK_SECRET_KEY}"
: "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:?Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}"

PRODUCT_DB="${PRODUCT_DATABASE_URL:-$DATABASE_URL}"
FEED_INTERNAL="${FEED_SERVER_URL:-http://feed:3002}"

echo "[koyeb] Product API (public)…"
koyeb service create "$KOYEB_APP_NAME/api" \
  --instance-type small \
  --regions "$KOYEB_REGION" \
  --docker "$SGRS_API_IMAGE" \
  --port 3003:http \
  --env "DATABASE_URL=${PRODUCT_DB}" \
  --env "ENCRYPTION_KEY=${ENCRYPTION_KEY}" \
  --env "API_KEY_PEPPER=${API_KEY_PEPPER}" \
  --env "CLERK_SECRET_KEY=${CLERK_SECRET_KEY}" \
  --env "CLERK_WEBHOOK_SECRET=${CLERK_WEBHOOK_SECRET:-}" \
  --env "FEED_SERVER_URL=${FEED_INTERNAL}" \
  --env "SWARM_API_TOKEN=${SWARM_API_TOKEN}" \
  --env "KERNEL_CONTROL_PLANE_ADMIN_TOKEN=${KERNEL_CONTROL_PLANE_ADMIN_TOKEN:-}" \
  --env "NODE_ENV=production" \
  --checks 3003:http:/api/health \
  ${KOYEB_API_DOMAIN:+--routes "${KOYEB_API_DOMAIN}:3003"} \
  2>/dev/null || echo "  (api may already exist — use koyeb service update)"

echo "[koyeb] Studio (public)…"
koyeb service create "$KOYEB_APP_NAME/studio" \
  --instance-type eco-small \
  --regions "$KOYEB_REGION" \
  --docker "$SGRS_STUDIO_IMAGE" \
  --port 3001:http \
  --env "CLERK_SECRET_KEY=${CLERK_SECRET_KEY}" \
  --env "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
  --env "NEXT_PUBLIC_BACKEND_API_URL=${NEXT_PUBLIC_BACKEND_API_URL}" \
  --env "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}" \
  --env "NODE_ENV=production" \
  --checks 3001:http:/api/health \
  ${KOYEB_STUDIO_DOMAIN:+--routes "${KOYEB_STUDIO_DOMAIN}:3001"} \
  2>/dev/null || echo "  (studio may already exist — use koyeb service update)"

echo "[koyeb] Public door deployed. Configure Clerk redirect URLs to Studio domain."
