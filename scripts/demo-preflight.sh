#!/usr/bin/env bash
# =============================================================================
# Demo preflight: ensure all services needed for the demo are running.
# Starts Docker services that may have exited, then verifies connectivity.
#
# Usage:  ./scripts/demo-preflight.sh
#         DEMO_SKIP_DOCKER=1 ./scripts/demo-preflight.sh   # skip docker compose up
#         DEMO_SKIP_PREFLIGHT=1 pnpm run demo             # bypass (demo-server)
# =============================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; . ./.env; set +a; fi
RUNNER="${RUNNER:-pnpm}"
if ! command -v pnpm >/dev/null 2>&1 || [ ! -f pnpm-lock.yaml ]; then RUNNER=npm; fi

echo "Demo preflight: checking required services..."
echo ""

# 1. Ensure Docker services are up (postgres, s3, nats, facts-worker, otel-collector, prometheus, grafana)
if [ "${DEMO_SKIP_DOCKER:-0}" != "1" ] && command -v docker >/dev/null 2>&1; then
  echo "Ensuring Docker services are running..."
  if docker compose up -d postgres s3 nats facts-worker otel-collector prometheus grafana 2>/dev/null; then
    echo "  Docker services started or already up."
  else
    echo "  Warning: could not start Docker services. Run manually:"
    echo "    docker compose up -d postgres s3 nats facts-worker otel-collector prometheus grafana"
    echo ""
  fi
  # Brief wait for containers to be ready
  sleep 2
else
  if [ "${DEMO_SKIP_DOCKER:-0}" = "1" ]; then
    echo "Skipping Docker startup (DEMO_SKIP_DOCKER=1)."
  else
    echo "Docker not found; assuming services are running elsewhere."
  fi
  echo ""
fi

# 2. Run connectivity checks (postgres, s3, nats, facts-worker, feed)
echo "Verifying connectivity..."
CHECK_FEED=1 $RUNNER run check:services
CHECK_EXIT=$?

if [ $CHECK_EXIT -ne 0 ]; then
  echo ""
  echo "Preflight failed. Before running the demo:"
  echo "  1. Start Docker: docker compose up -d postgres s3 nats facts-worker otel-collector prometheus grafana"
  echo "  2. Migrations:  $RUNNER run ensure-bucket && $RUNNER run ensure-schema && $RUNNER run ensure-stream"
  echo "  3. Start swarm:  $RUNNER run swarm:start  (terminal 1)  # NOT pnpm run swarm"
  echo "  4. Start feed:  $RUNNER run feed         (terminal 2)"
  echo "  5. Start demo:  $RUNNER run demo         (terminal 3)"
  echo ""
  echo "Grafana at http://localhost:3004 requires otel-collector. If it exited, run:"
  echo "  docker compose up -d otel-collector"
  exit 1
fi

echo ""
echo "All services OK. Start swarm hatchery and feed if not already running:"
echo "  $RUNNER run swarm:start   (terminal 1)  # full pipeline; pnpm run swarm = facts-only)"
echo "  $RUNNER run feed         (terminal 2)"
echo "  $RUNNER run demo         (terminal 3)"
echo ""
