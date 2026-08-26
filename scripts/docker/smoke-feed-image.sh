#!/usr/bin/env bash
# Smoke-test a built feed image: boot checks (no ENOENT) + optional /health with Postgres.
set -euo pipefail

IMAGE="${1:-swarm-feed:local}"
FEED_PORT="${FEED_PORT:-3012}"
PG_PORT="${PG_PORT:-5434}"

echo "=== smoke: import/boot (no DB) ==="
docker run --rm "$IMAGE" node -e "
  import('./dist/feed/main.js').then(() => console.log('feed module ok')).catch(e => { console.error(e); process.exit(1); });
"

if [[ "${SMOKE_SKIP_HEALTH:-0}" == "1" ]]; then
  echo "SMOKE_SKIP_HEALTH=1 — skipping /health"
  exit 0
fi

echo "=== smoke: /health with ephemeral Postgres ==="
PG_CID=""
FEED_CID=""
cleanup() {
  docker rm -f "$FEED_CID" "$PG_CID" 2>/dev/null || true
}
trap cleanup EXIT

PG_CID=$(docker run -d \
  -e POSTGRES_USER=swarm \
  -e POSTGRES_PASSWORD=swarm \
  -e POSTGRES_DB=swarm \
  -p "${PG_PORT}:5432" \
  pgvector/pgvector:pg15)

for i in $(seq 1 30); do
  docker exec "$PG_CID" pg_isready -U swarm -d swarm >/dev/null 2>&1 && break
  sleep 1
done

FEED_CID=$(docker run -d \
  -p "${FEED_PORT}:3002" \
  -e FEED_HOST=0.0.0.0 \
  -e FEED_PORT=3002 \
  -e DISABLE_FEED_AUTH=1 \
  -e DATABASE_URL="postgresql://swarm:swarm@host.docker.internal:${PG_PORT}/swarm" \
  -e NATS_URL=nats://127.0.0.1:4222 \
  "$IMAGE")

for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${FEED_PORT}/health" || true)
  if [[ "$code" == "200" || "$code" == "503" ]]; then
    echo "health responded HTTP $code (503 ok without NATS)"
    curl -s "http://127.0.0.1:${FEED_PORT}/health" | head -c 200
    echo
    exit 0
  fi
  if ! docker ps -q --filter "id=$FEED_CID" | grep -q .; then
    echo "feed container exited early:"
    docker logs "$FEED_CID" 2>&1 | tail -20
    exit 1
  fi
  sleep 1
done

echo "timeout waiting for /health"
docker logs "$FEED_CID" 2>&1 | tail -20
exit 1
