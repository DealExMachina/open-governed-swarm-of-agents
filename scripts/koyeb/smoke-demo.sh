#!/usr/bin/env bash
# Smoke-check demo health endpoints (requires public URLs in env).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "${KOYEB_ENV_FILE:-$ROOT/scripts/koyeb/env.local}"

API_URL="${SMOKE_API_URL:-${NEXT_PUBLIC_BACKEND_API_URL:-}}"
STUDIO_URL="${SMOKE_STUDIO_URL:-${NEXT_PUBLIC_API_URL:-}}"

if [[ -z "$API_URL" || -z "$STUDIO_URL" ]]; then
  echo "Set NEXT_PUBLIC_BACKEND_API_URL and NEXT_PUBLIC_API_URL (or SMOKE_* overrides)."
  exit 1
fi

check() {
  local name="$1" url="$2"
  echo -n "[smoke] ${name} ${url} … "
  code="$(curl -sf -o /dev/null -w '%{http_code}' "$url" || echo "000")"
  if [[ "$code" == "200" ]]; then
    echo "OK"
  else
    echo "FAIL (${code})"
    exit 1
  fi
}

check "api" "${API_URL%/}/api/health"
check "studio" "${STUDIO_URL%/}/api/health"

echo "[smoke] Public door healthy."
