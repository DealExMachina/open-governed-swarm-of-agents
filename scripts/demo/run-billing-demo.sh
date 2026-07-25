#!/usr/bin/env bash
# =============================================================================
# Delta Billing Demo runner: seed 2 tenants x 5 scopes, drive billable deltas,
# print per-tenant balances/overage.
#
# Default mode is synthetic (self-contained, deterministic "explode"). Set
# DRIVE_MODE=real to drive the actual agent pipeline (requires the swarm
# hatchery running: pnpm run swarm:start).
#
# Usage:
#   ./scripts/demo/run-billing-demo.sh
#   DRIVE_MODE=real ./scripts/demo/run-billing-demo.sh
#   DEMO_SKIP_DOCKER=1 ./scripts/demo/run-billing-demo.sh
# =============================================================================

set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -f .env ]; then set -a; . ./.env; set +a; fi
RUNNER="${RUNNER:-pnpm}"
if ! command -v pnpm >/dev/null 2>&1 || [ ! -f pnpm-lock.yaml ]; then RUNNER=npm; fi

DRIVE_MODE="${DRIVE_MODE:-synthetic}"

echo "=== Delta Billing Demo (mode=${DRIVE_MODE}) ==="
echo ""

# 1. Ensure Postgres is up (billing lives in Postgres; synthetic mode needs only this).
if [ "${DEMO_SKIP_DOCKER:-0}" != "1" ] && command -v docker >/dev/null 2>&1; then
  echo "Ensuring Postgres is running..."
  if [ "$DRIVE_MODE" = "real" ]; then
    docker compose up -d postgres s3 nats facts-worker otel-collector prometheus grafana 2>/dev/null || \
      echo "  Warning: could not start all Docker services."
  else
    docker compose up -d postgres otel-collector prometheus grafana 2>/dev/null || \
      echo "  Warning: could not start Docker services."
  fi
  sleep 2
fi

# 2. Migrations (idempotent) — creates delta billing tables if missing.
echo "Applying migrations (ensure-schema)..."
$RUNNER run ensure-schema

# 3. Real mode needs the hatchery reachable for per-scope rebinding.
if [ "$DRIVE_MODE" = "real" ]; then
  echo ""
  echo "Real mode: the swarm hatchery must be running (pnpm run swarm:start) so"
  echo "scopes can be rebound and the agent pipeline can mint deltas."
  echo ""
fi

# 4. Seed tenants, scopes, subscriptions.
echo "Seeding tenants + scopes + subscriptions..."
$RUNNER run seed:billing-demo

# 5. Drive the scenario (mints net-new billable deltas, meters them).
echo ""
echo "Driving scopes..."
DRIVE_MODE="$DRIVE_MODE" $RUNNER run drive:billing-demo

echo ""
echo "Done. Open the Delta Billing dashboard in Grafana (http://localhost:3004):"
echo "  Dashboards -> Delta Billing -> select tenant (Meridian Capital / Orion Advisory)"
echo ""
echo "Inspect the ledgers directly:"
echo "  delta_events    (net-new billable deltas per tenant/scope)"
echo "  metering_events (prepaid vs overage split per delta)"
