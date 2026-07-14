#!/usr/bin/env bash
# Wipe telemetry data from old swarm runs.
# - Prometheus: clears TSDB so Grafana dashboards start fresh
# - OTEL collector: in-memory only, no persistent storage
# - Grafana: keeps dashboards/settings (not run data)
#
# Requires docker compose. Run from repo root.
# Env: RESET_TELEMETRY=1 (optional, for use by reset-e2e)
#
# Usage: bash scripts/reset-telemetry.sh

set -e

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found, skipping telemetry reset"
  exit 0
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose not available, skipping telemetry reset"
  exit 0
fi

echo "Resetting telemetry (Prometheus TSDB)..."

# Stop Prometheus so we can safely wipe its volume
docker compose stop prometheus 2>/dev/null || true

# Run one-off container with same volume to clear TSDB
# Prometheus will recreate data dir on next start
docker compose run --rm prometheus sh -c "rm -rf /prometheus/*" 2>/dev/null || true

# Restart Prometheus
docker compose start prometheus 2>/dev/null || echo "Prometheus not in compose, or already down"

echo "Telemetry reset done. Grafana will show fresh data after next swarm run."
