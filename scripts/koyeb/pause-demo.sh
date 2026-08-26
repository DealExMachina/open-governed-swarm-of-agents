#!/usr/bin/env bash
# Pause expensive always-on services between demos.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "${KOYEB_ENV_FILE:-$ROOT/scripts/koyeb/env.local}"

: "${KOYEB_APP_NAME:?Set KOYEB_APP_NAME}"

SERVICES=(nats minio hatchery facts-worker feed)

for svc in "${SERVICES[@]}"; do
  echo "[koyeb] Pausing ${KOYEB_APP_NAME}/${svc}…"
  koyeb service pause "${KOYEB_APP_NAME}/${svc}" 2>/dev/null || \
    koyeb service update "${KOYEB_APP_NAME}/${svc}" --scale 0 2>/dev/null || \
    echo "  (could not pause ${svc} — adjust manually)"
done

echo "[koyeb] Paused. Postgres + api/studio may still incur cost."
