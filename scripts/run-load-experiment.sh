#!/usr/bin/env bash
# Load and variational experiment: stress state graph, progression, finality.
#
# Usage:
#   ./scripts/run-load-experiment.sh [OPTIONS]
#
# Options:
#   --injection=baseline|fast|stress|burst   Context injection rate (default: baseline)
#   --graph=small|medium|large               Graph size (default: small)
#   --scaling=default|scaled                  Agent hatchery scaling (default: default)
#   --duration=N                             Wait N seconds after inject (default: 180)
#   --sweep                                   Run full 2^3 factorial (8 runs)
#   --no-swarm                               Skip starting hatchery (manual swarm)
#
# Single run example:
#   ./scripts/run-load-experiment.sh --injection=stress --graph=large --duration=180
#
# Full sweep:
#   ./scripts/run-load-experiment.sh --sweep
#
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi

RUNNER="pnpm"
[ -f pnpm-lock.yaml ] || RUNNER="npm"
LOG_DIR="${LOG_DIR:-/tmp}"
mkdir -p "$LOG_DIR"

INJECTION="baseline"
GRAPH="small"
SCALING="default"
DURATION=180
SWEEP=0
RUN_SWARM=1
HATCHERY_PID=""
SIM_PID=""

for arg in "$@"; do
  case "$arg" in
    --injection=*) INJECTION="${arg#*=}";;
    --graph=*)     GRAPH="${arg#*=}";;
    --scaling=*)   SCALING="${arg#*=}";;
    --duration=*)   DURATION="${arg#*=}";;
    --sweep)       SWEEP=1;;
    --no-swarm)   RUN_SWARM=0;;
    *) echo "[Load] Unknown option: $arg"; exit 1;;
  esac
done

cleanup() {
  [ -n "$SIM_PID" ] && kill "$SIM_PID" 2>/dev/null || true
  [ -n "$SIM_PID" ] && wait "$SIM_PID" 2>/dev/null || true
  if [ -n "$HATCHERY_PID" ]; then
    echo "[Load] Stopping hatchery (pid $HATCHERY_PID)..."
    kill "$HATCHERY_PID" 2>/dev/null || true
    wait "$HATCHERY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Map injection level to env
set_injection_env() {
  case "$1" in
    baseline) export LOAD_INJECT_DELAY_MS=20000; export LOAD_BURST=0;;
    fast)     export LOAD_INJECT_DELAY_MS=5000;  export LOAD_BURST=0;;
    stress)   export LOAD_INJECT_DELAY_MS=2000;  export LOAD_BURST=0;;
    burst)    export LOAD_INJECT_DELAY_MS=0;     export LOAD_BURST=1;;
    *) echo "[Load] Invalid injection: $1"; exit 1;;
  esac
}

# Map graph to claims/rho
set_graph_env() {
  case "$1" in
    small)  export CLAIMS=50;  export RHO=0.1;;
    medium) export CLAIMS=200; export RHO=0.2;;
    large)  export CLAIMS=500; export RHO=0.3;;
    *) echo "[Load] Invalid graph: $1"; exit 1;;
  esac
}

# Map scaling to hatchery env
set_scaling_env() {
  case "$1" in
    default) ;;
    scaled)
      export HATCHERY_FACTS_MIN=2 HATCHERY_FACTS_MAX=6
      export HATCHERY_DRIFT_MIN=2 HATCHERY_DRIFT_MAX=6
      export HATCHERY_PLANNER_MIN=2 HATCHERY_PLANNER_MAX=6
      export HATCHERY_STATUS_MIN=2 HATCHERY_STATUS_MAX=4
      ;;
    *) echo "[Load] Invalid scaling: $1"; exit 1;;
  esac
}

run_single() {
  local inj="$1"
  local grp="$2"
  local scl="$3"

  set_injection_env "$inj"
  set_graph_env "$grp"
  set_scaling_env "$scl"

  local run_id="load-${inj}-${grp}-${scl}"
  echo ""
  echo "[Load] ========== Run: $run_id =========="
  echo "[Load] injection=$inj graph=$grp scaling=$scl duration=${DURATION}s"

  # Step 0: reset
  echo "[Load] Killing stale agents..."
  for port in 3001; do
    lsof -ti :"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
  pkill -f "AGENT_ROLE=" 2>/dev/null || true
  sleep 1

  echo "[Load] Resetting DB..."
  node --loader ts-node/esm scripts/reset-e2e.ts 2>/dev/null || true
  node --loader ts-node/esm scripts/ensure-schema.ts
  node --loader ts-node/esm scripts/ensure-bucket.ts
  node --loader ts-node/esm scripts/ensure-stream.ts

  # Step 1: seed exp2 graph
  echo "[Load] Seeding exp2 graph (claims=$CLAIMS, rho=$RHO)..."
  node --loader ts-node/esm scripts/seed-exp2-graph.ts --claims="$CLAIMS" --rho="$RHO"

  # Step 2: start hatchery (BOOTSTRAP=1 kicks off pipeline with initial jobs)
  if [ "$RUN_SWARM" = 1 ]; then
    echo "[Load] Starting hatchery..."
    BOOTSTRAP=1 AGENT_ROLE=hatchery AGENT_ID=hatchery-load node --loader ts-node/esm src/swarm.ts \
      >> "$LOG_DIR/swarm-load-hatchery.log" 2>&1 &
    HATCHERY_PID=$!

    MITL_PORT="${MITL_PORT:-3001}"
    for i in $(seq 1 45); do
      if curl -sf "http://127.0.0.1:${MITL_PORT}/health" >/dev/null 2>&1; then
        echo "[Load] MITL healthy."
        break
      fi
      if [ "$i" = 45 ]; then
        echo "[Load] MITL not ready. Check $LOG_DIR/swarm-load-hatchery.log"
        exit 1
      fi
      sleep 1
    done

    echo "[Load] Starting simulate-mitl (finality auto-approve)..."
    node --loader ts-node/esm scripts/simulate-mitl-approve.ts --finality-option=approve_finality &
    SIM_PID=$!
  fi

  # Step 3: wait for bootstrap to settle, then inject
  sleep 5
  echo "[Load] Running loadgen-inject..."
  LOAD_INJECT_DELAY_MS="$LOAD_INJECT_DELAY_MS" LOAD_BURST="$LOAD_BURST" \
    node --loader ts-node/esm scripts/loadgen-inject.ts

  # Step 4: wait for pipeline
  echo "[Load] Waiting ${DURATION}s for pipeline..."
  sleep "$DURATION"

  # Step 5: collect with run_id for load metrics
  echo "[Load] Collecting results..."
  EXP_ID=exp-load LOAD_RUN_ID="$run_id" \
    LOAD_INJECTION="$inj" LOAD_GRAPH="$grp" LOAD_SCALING="$scl" \
    LOAD_DURATION="$DURATION" node --loader ts-node/esm scripts/collect-experiment-results.ts exp-load

  # Kill hatchery/sim before next sweep run
  [ -n "$SIM_PID" ] && kill "$SIM_PID" 2>/dev/null || true
  [ -n "$HATCHERY_PID" ] && kill "$HATCHERY_PID" 2>/dev/null || true
  sleep 2
  HATCHERY_PID=""
  SIM_PID=""
}

if [ "$SWEEP" = 1 ]; then
  echo "[Load] Full 2^3 sweep: injection x graph x scaling"
  for inj in baseline stress; do
    for grp in small large; do
      for scl in default scaled; do
        run_single "$inj" "$grp" "$scl"
      done
    done
  done
  echo "[Load] Sweep complete."
else
  run_single "$INJECTION" "$GRAPH" "$SCALING"
fi
