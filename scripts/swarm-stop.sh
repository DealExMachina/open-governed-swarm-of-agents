#!/usr/bin/env bash
# Gracefully stop the swarm hatchery. Sends SIGTERM so agents drain before exit.
# Uses PID file from swarm:start when available; otherwise falls back to pkill.
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
LOG_DIR="${LOG_DIR:-/tmp}"

if [ -f "$LOG_DIR/swarm-hatchery.pid" ]; then
  PID=$(cat "$LOG_DIR/swarm-hatchery.pid")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping swarm (SIGTERM, PID $PID)..."
    kill -TERM "$PID" 2>/dev/null || true
    for i in $(seq 1 15); do
      kill -0 "$PID" 2>/dev/null || { echo "Swarm stopped."; rm -f "$LOG_DIR/swarm-hatchery.pid"; exit 0; }
      sleep 1
    done
    echo "Swarm did not exit in 15s, forcing..."
    kill -9 "$PID" 2>/dev/null || true
    rm -f "$LOG_DIR/swarm-hatchery.pid"
  else
    echo "Swarm not running (stale PID file removed)."
    rm -f "$LOG_DIR/swarm-hatchery.pid"
  fi
else
  echo "Stopping swarm (SIGTERM, matching hatchery process)..."
  pkill -SIGTERM -f "swarm-hatchery" 2>/dev/null || \
  pkill -SIGTERM -f "run swarm" 2>/dev/null || true
  for i in $(seq 1 10); do
    pgrep -f "AGENT_ROLE=hatchery" >/dev/null 2>&1 || { echo "Swarm stopped."; exit 0; }
    sleep 1
  done
  echo "Process did not exit in 10s."
  echo "Forcing shutdown..."
  pkill -9 -f "AGENT_ROLE=hatchery" 2>/dev/null || true
fi

# Free ports in case child servers (MITL, resolution-mcp) linger
for port in 3001 3005; do
  lsof -ti :$port 2>/dev/null | xargs kill -9 2>/dev/null || true
done
echo "Done."
