#!/usr/bin/env bash
# Resume paused demo services.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "${KOYEB_ENV_FILE:-$ROOT/scripts/koyeb/env.local}"

: "${KOYEB_APP_NAME:?Set KOYEB_APP_NAME}"

SERVICES=(nats minio facts-worker feed hatchery)

for svc in "${SERVICES[@]}"; do
  echo "[koyeb] Resuming ${KOYEB_APP_NAME}/${svc}…"
  koyeb service resume "${KOYEB_APP_NAME}/${svc}" 2>/dev/null || \
    koyeb service update "${KOYEB_APP_NAME}/${svc}" --scale 1 2>/dev/null || \
    echo "  (could not resume ${svc} — adjust manually)"
done

echo "[koyeb] Stack resumed."
