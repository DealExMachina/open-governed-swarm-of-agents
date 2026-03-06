#!/usr/bin/env bash
# Run an experiment: reset, start hatchery, drive documents through pipeline, collect.
#
# Usage: ./scripts/run-experiment.sh <exp_id> [options]
#   exp1  --contradictions=0|1|3|5 --rounds=7 --resolve-at=5
#   exp2  --claims=50 --rho=0.3 --rounds=10
#   exp3  --pattern=spike-and-drop --rounds=5
#   exp4  --rounds=7 --resolve-at=5
#   exp5  (runs 3 times: YOLO, MITL, MASTER)
#   exp6  --rounds=7 (full pipeline with resolver agent — Assumption #3)
#   exp7  (runs 3 times: YOLO, MITL, MASTER with lowered escalation threshold)
#   exp8  (runs 3 times: baseline, inflate, collude — adversarial agent defense)
#   exp9  (local confluence — no LLM/Docker needed, Postgres only)
#   insurance --rounds=22 (insurance onboarding/quote corpus, 22 docs, 20+ cycles)
#   noisy --corpus=docs-noisy (ambiguous/hedging documents)
#   financial --rounds=8 (financial consolidation with dual temporality)
#
# Common options:
#   --interval=20       Seconds between document injections (default 20)
#   --rounds=N          Number of document rounds (default 7)
#   --resolve-at=N      Round to inject resolution (default: none; exp1 default: 5)
#   --no-swarm          Skip starting hatchery (use externally running agents)
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi

EXP_ID="${1:-exp1}"
shift || true
INTERVAL=20
ROUNDS=7
RESOLVE_AT=""
RUN_SWARM=1
SIM_PID=""
HATCHERY_PID=""
DRIVER_PID=""
EXTRA_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --interval=*) INTERVAL="${arg#*=}";;
    --rounds=*) ROUNDS="${arg#*=}";;
    --resolve-at=*) RESOLVE_AT="${arg#*=}";;
    --contradictions=*) CONTRADICTIONS="${arg#*=}";;
    --no-swarm) RUN_SWARM=0;;
    *) EXTRA_ARGS+=("$arg");;
  esac
done

RUNNER="pnpm"
[ -f pnpm-lock.yaml ] || RUNNER="npm"

LOG_DIR="${LOG_DIR:-/tmp}"
mkdir -p "$LOG_DIR"

cleanup() {
  [ -n "$DRIVER_PID" ] && kill "$DRIVER_PID" 2>/dev/null || true
  [ -n "$DRIVER_PID" ] && wait "$DRIVER_PID" 2>/dev/null || true
  [ -n "$SIM_PID" ] && kill "$SIM_PID" 2>/dev/null || true
  [ -n "$SIM_PID" ] && wait "$SIM_PID" 2>/dev/null || true
  if [ -n "$HATCHERY_PID" ]; then
    echo "[Exp] Stopping hatchery (pid $HATCHERY_PID)..."
    kill "$HATCHERY_PID" 2>/dev/null || true
    wait "$HATCHERY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "[Exp] $EXP_ID | rounds=$ROUNDS | interval=${INTERVAL}s | resolve-at=${RESOLVE_AT:-none}"

# ── Step 0: Kill stale agents and reset DB ───────────────────────────────────
echo "[Exp] Killing stale agent processes..."
for port in 3001; do
  lsof -ti :"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
done
pkill -f "AGENT_ROLE=" 2>/dev/null || true
sleep 1

echo "[Exp] Resetting DB (clean sheet)..."
node --loader ts-node/esm scripts/reset-e2e.ts 2>/dev/null || true

echo "[Exp] Ensuring schema, bucket, stream..."
node --loader ts-node/esm scripts/ensure-schema.ts
node --loader ts-node/esm scripts/ensure-bucket.ts
node --loader ts-node/esm scripts/ensure-stream.ts

# ── Step 1: Start hatchery ───────────────────────────────────────────────────
if [ "$RUN_SWARM" = 1 ]; then
  echo "[Exp] Starting hatchery (fresh code)..."
  : > "$LOG_DIR/swarm-exp-hatchery.log"
  AGENT_ROLE=hatchery AGENT_ID=hatchery-exp node --loader ts-node/esm src/swarm.ts \
    >> "$LOG_DIR/swarm-exp-hatchery.log" 2>&1 &
  HATCHERY_PID=$!
  echo "[Exp] Hatchery pid: $HATCHERY_PID"

  echo "[Exp] Waiting for MITL server health..."
  MITL_PORT="${MITL_PORT:-3001}"
  for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${MITL_PORT}/health" >/dev/null 2>&1; then
      echo "[Exp] MITL server healthy."
      break
    fi
    if [ "$i" = 30 ]; then
      echo "[Exp] MITL server not ready after 30s. Check $LOG_DIR/swarm-exp-hatchery.log"
      exit 1
    fi
    sleep 1
  done

  # For exp4/exp5/noisy, start simulate-mitl with finality handling
  # NOTE: exp6 intentionally omitted — needs full convergence trajectory without auto-approve
  if [ "$EXP_ID" = "exp4" ] || [ "$EXP_ID" = "exp5" ] || [ "$EXP_ID" = "noisy" ]; then
    echo "[Exp] Starting simulate-mitl (with finality auto-approve)..."
    node --loader ts-node/esm scripts/simulate-mitl-approve.ts --finality-option=approve_finality &
    SIM_PID=$!
  fi
fi

# ── Step 2: Drive documents through pipeline ─────────────────────────────────
RESOLVE_OPT=""
[ -n "$RESOLVE_AT" ] && RESOLVE_OPT="--resolve-at=$RESOLVE_AT"

run_single_experiment() {
  local corpus="$1"
  local extra_driver_args="$2"
  local label="${3:-$corpus}"

  echo "[Exp] Driving $label: corpus=$corpus rounds=$ROUNDS interval=${INTERVAL}s"
  node --loader ts-node/esm scripts/drive-experiment.ts \
    --corpus="$corpus" \
    --rounds="$ROUNDS" \
    --interval="$INTERVAL" \
    $RESOLVE_OPT \
    $extra_driver_args \
    "${EXTRA_ARGS[@]}"
}

case "$EXP_ID" in
  exp1)
    CONTRADICT="${CONTRADICTIONS:-3}"
    [ -z "$RESOLVE_AT" ] && RESOLVE_OPT="--resolve-at=5,6,7"
    run_single_experiment "exp1" "--contradictions=$CONTRADICT"
    ;;
  exp2)
    run_single_experiment "exp2" "--claims=${CLAIMS:-50} --rho=${RHO:-0.3}"
    ;;
  exp3)
    run_single_experiment "exp3" "--pattern=${PATTERN:-spike-and-drop}"
    ;;
  exp4)
    run_single_experiment "demo" "" "exp4-governance"
    ;;
  exp6)
    ROUNDS="${ROUNDS:-7}"
    [ -z "$RESOLVE_AT" ] && RESOLVE_OPT="--resolve-at=5,6,7"
    echo "[Exp] Exp6: full pipeline with resolver agent (Assumption #3: monotonic progress)"
    run_single_experiment "exp6" "" "exp6-full-pipeline"
    ;;
  exp7)
    ROUNDS="${ROUNDS:-7}"
    [ -z "$RESOLVE_AT" ] && RESOLVE_OPT="--resolve-at=5,6,7"
    echo "[Exp] Exp7: tier coverage — running 3 governance modes with lowered escalation threshold"
    for mode in YOLO MITL MASTER; do
      echo ""
      echo "[Exp] ═══ Exp7 run: GOVERNANCE_MODE=$mode ═══"

      # ── Stop previous hatchery + simulate-mitl ──
      if [ -n "$HATCHERY_PID" ]; then
        echo "[Exp] Stopping previous hatchery (pid $HATCHERY_PID)..."
        kill "$HATCHERY_PID" 2>/dev/null || true
        wait "$HATCHERY_PID" 2>/dev/null || true
        HATCHERY_PID=""
      fi
      if [ -n "$SIM_PID" ]; then
        kill "$SIM_PID" 2>/dev/null || true
        wait "$SIM_PID" 2>/dev/null || true
        SIM_PID=""
      fi

      # ── Reset DB/NATS ──
      node --loader ts-node/esm scripts/reset-e2e.ts 2>/dev/null || true
      node --loader ts-node/esm scripts/ensure-schema.ts 2>/dev/null
      node --loader ts-node/esm scripts/ensure-stream.ts 2>/dev/null

      # ── Start hatchery with correct governance mode ──
      # governance.yaml now blocks on [high, critical] — no separate exp7 policy needed.
      export GOVERNANCE_MODE="$mode"
      if [ "$RUN_SWARM" = 1 ]; then
        echo "[Exp] Starting hatchery for mode=$mode..."
        : > "$LOG_DIR/swarm-exp-hatchery.log"
        GOVERNANCE_MODE="$mode" \
          AGENT_ROLE=hatchery AGENT_ID=hatchery-exp \
          node --loader ts-node/esm src/swarm.ts \
          >> "$LOG_DIR/swarm-exp-hatchery.log" 2>&1 &
        HATCHERY_PID=$!
        echo "[Exp] Hatchery pid: $HATCHERY_PID"

        echo "[Exp] Waiting for MITL server health..."
        MITL_PORT="${MITL_PORT:-3001}"
        for i in $(seq 1 30); do
          if curl -sf "http://127.0.0.1:${MITL_PORT}/health" >/dev/null 2>&1; then
            echo "[Exp] MITL server healthy."
            break
          fi
          if [ "$i" = 30 ]; then
            echo "[Exp] MITL server not ready after 30s. Check $LOG_DIR/swarm-exp-hatchery.log"
            exit 1
          fi
          sleep 1
        done

        # MITL mode needs simulate-mitl to auto-approve pending proposals
        if [ "$mode" = "MITL" ]; then
          echo "[Exp] Starting simulate-mitl (auto-approve for Tier 2 testing)..."
          node --loader ts-node/esm scripts/simulate-mitl-approve.ts &
          SIM_PID=$!
        fi
      fi

      run_single_experiment "exp6" "" "exp7-$mode"

      echo "[Exp] Collecting exp7-$mode results..."
      node --loader ts-node/esm scripts/collect-experiment-results.ts "exp7" 2>/dev/null || true
    done
    unset GOVERNANCE_MODE
    echo ""
    echo "[Exp] Exp7 complete. Analyzing tier coverage..."
    node --loader ts-node/esm scripts/analyze-tier-coverage.ts "docs/experiments/exp7/results/" 2>/dev/null || true
    echo "[Exp] Done. See docs/experiments/exp7/results/"
    exit 0
    ;;
  exp8)
    ROUNDS="${ROUNDS:-7}"
    echo "[Exp] Exp8: adversarial agent defense — validating Assumption #5 (cooperative model)"
    echo "[Exp] Running 4 sub-experiments: baseline, inflate, collude, compensate"
    for adv_mode in baseline inflate collude compensate; do
      echo ""
      echo "[Exp] ═══ Exp8 run: adversarial_mode=$adv_mode ═══"

      # ── Stop previous hatchery + simulate-mitl ──
      if [ -n "$HATCHERY_PID" ]; then
        echo "[Exp] Stopping previous hatchery (pid $HATCHERY_PID)..."
        kill "$HATCHERY_PID" 2>/dev/null || true
        wait "$HATCHERY_PID" 2>/dev/null || true
        HATCHERY_PID=""
      fi
      if [ -n "$SIM_PID" ]; then
        kill "$SIM_PID" 2>/dev/null || true
        wait "$SIM_PID" 2>/dev/null || true
        SIM_PID=""
      fi

      # ── Reset DB/NATS ──
      node --loader ts-node/esm scripts/reset-e2e.ts 2>/dev/null || true
      node --loader ts-node/esm scripts/ensure-schema.ts 2>/dev/null
      node --loader ts-node/esm scripts/ensure-stream.ts 2>/dev/null

      # ── Start hatchery (YOLO mode — most permissive, so adversarial has best chance) ──
      export GOVERNANCE_MODE="YOLO"
      if [ "$RUN_SWARM" = 1 ]; then
        echo "[Exp] Starting hatchery for adversarial mode=$adv_mode (YOLO governance)..."
        : > "$LOG_DIR/swarm-exp-hatchery.log"
        GOVERNANCE_MODE="YOLO" \
          AGENT_ROLE=hatchery AGENT_ID=hatchery-exp \
          node --loader ts-node/esm src/swarm.ts \
          >> "$LOG_DIR/swarm-exp-hatchery.log" 2>&1 &
        HATCHERY_PID=$!
        echo "[Exp] Hatchery pid: $HATCHERY_PID"

        echo "[Exp] Waiting for MITL server health..."
        MITL_PORT="${MITL_PORT:-3001}"
        for i in $(seq 1 30); do
          if curl -sf "http://127.0.0.1:${MITL_PORT}/health" >/dev/null 2>&1; then
            echo "[Exp] MITL server healthy."
            break
          fi
          if [ "$i" = 30 ]; then
            echo "[Exp] MITL server not ready after 30s. Check $LOG_DIR/swarm-exp-hatchery.log"
            exit 1
          fi
          sleep 1
        done
      fi

      # ── Drive with adversarial injection ──
      echo "[Exp] Driving exp8-$adv_mode with adversarial mode=$adv_mode..."
      node --loader ts-node/esm scripts/drive-exp8-adversarial.ts \
        --mode="$adv_mode" \
        --rounds="$ROUNDS" \
        --interval="$INTERVAL" \
        "${EXTRA_ARGS[@]}"

      echo "[Exp] Collecting exp8-$adv_mode results..."
      ADVERSARIAL_MODE="$adv_mode" \
        node --loader ts-node/esm scripts/collect-experiment-results.ts "exp8" 2>/dev/null || true
    done
    unset GOVERNANCE_MODE
    echo ""
    echo "[Exp] Exp8 complete. Analyzing adversarial defense..."
    node --loader ts-node/esm scripts/analyze-adversarial-defense.ts "docs/experiments/exp8/results/" 2>/dev/null || true
    echo "[Exp] Done. See docs/experiments/exp8/results/"
    exit 0
    ;;
  insurance)
    ROUNDS="${ROUNDS:-22}"
    [ -z "$RESOLVE_AT" ] && RESOLVE_OPT="--resolve-at=17,18,19"
    echo "[Exp] Insurance: onboarding and quote corpus (22 docs, ${ROUNDS} rounds)"
    run_single_experiment "insurance" ""
    ;;
  exp9)
    echo "[Exp] Exp9: local confluence — validating Assumption #2 (commutativity of CRDT operations)"
    echo "[Exp] This experiment requires only Postgres (no Docker/LLM/NATS needed)."
    # Ensure schema exists
    node --loader ts-node/esm scripts/ensure-schema.ts 2>/dev/null
    # Run the confluence driver
    npx tsx scripts/drive-exp9-confluence.ts "${EXTRA_ARGS[@]}"
    echo "[Exp] Done. See docs/experiments/exp9/results/"
    exit 0
    ;;
  demo-baseline)
    ROUNDS="${ROUNDS:-7}"
    [ -z "$RESOLVE_AT" ] && RESOLVE_OPT="--resolve-at=5,6,7"
    run_single_experiment "demo" "" "demo-ma-baseline"
    ;;
  noisy)
    run_single_experiment "noisy" "" "noisy-corpus"
    ;;
  financial)
    ROUNDS="${ROUNDS:-8}"
    [ -z "$RESOLVE_AT" ] && RESOLVE_OPT="--resolve-at=7,8"
    run_single_experiment "financial" "" "financial-consolidation"
    ;;
  exp5)
    echo "[Exp] Exp5: coverage-autonomy trade-off — running 3 governance modes"
    for mode in YOLO MITL MASTER; do
      echo ""
      echo "[Exp] ═══ Exp5 run: GOVERNANCE_MODE=$mode ═══"

      # ── Stop previous hatchery + simulate-mitl ──
      if [ -n "$HATCHERY_PID" ]; then
        echo "[Exp] Stopping previous hatchery (pid $HATCHERY_PID)..."
        kill "$HATCHERY_PID" 2>/dev/null || true
        wait "$HATCHERY_PID" 2>/dev/null || true
        HATCHERY_PID=""
      fi
      if [ -n "$SIM_PID" ]; then
        kill "$SIM_PID" 2>/dev/null || true
        wait "$SIM_PID" 2>/dev/null || true
        SIM_PID=""
      fi

      # ── Reset DB/NATS (hatchery already stopped, safe to reset) ──
      node --loader ts-node/esm scripts/reset-e2e.ts 2>/dev/null || true
      node --loader ts-node/esm scripts/ensure-schema.ts 2>/dev/null
      node --loader ts-node/esm scripts/ensure-stream.ts 2>/dev/null

      # ── Start fresh hatchery WITH correct GOVERNANCE_MODE ──
      export GOVERNANCE_MODE="$mode"
      if [ "$RUN_SWARM" = 1 ]; then
        echo "[Exp] Starting hatchery for mode=$mode..."
        : > "$LOG_DIR/swarm-exp-hatchery.log"
        GOVERNANCE_MODE="$mode" AGENT_ROLE=hatchery AGENT_ID=hatchery-exp \
          node --loader ts-node/esm src/swarm.ts \
          >> "$LOG_DIR/swarm-exp-hatchery.log" 2>&1 &
        HATCHERY_PID=$!
        echo "[Exp] Hatchery pid: $HATCHERY_PID"

        echo "[Exp] Waiting for MITL server health..."
        MITL_PORT="${MITL_PORT:-3001}"
        for i in $(seq 1 30); do
          if curl -sf "http://127.0.0.1:${MITL_PORT}/health" >/dev/null 2>&1; then
            echo "[Exp] MITL server healthy."
            break
          fi
          if [ "$i" = 30 ]; then
            echo "[Exp] MITL server not ready after 30s. Check $LOG_DIR/swarm-exp-hatchery.log"
            exit 1
          fi
          sleep 1
        done

        echo "[Exp] Starting simulate-mitl (with finality auto-approve)..."
        node --loader ts-node/esm scripts/simulate-mitl-approve.ts --finality-option=approve_finality &
        SIM_PID=$!
      fi

      run_single_experiment "demo" "" "exp5-$mode"

      echo "[Exp] Collecting exp5-$mode results..."
      node --loader ts-node/esm scripts/collect-experiment-results.ts "exp5" 2>/dev/null || true
    done
    unset GOVERNANCE_MODE
    echo "[Exp] Exp5 complete. Compare results across YOLO/MITL/MASTER."
    echo "[Exp] Done. See docs/experiments/exp5/results/"
    exit 0
    ;;
  exp1-sweep)
    echo "[Exp] Exp1-Sweep: contradiction density sweep under vector finality"
    echo "[Exp] Running 4 contradiction densities: 0, 1, 3, 5"
    for C in 0 1 3 5; do
      echo ""
      echo "[Exp] ═══ Exp1-Sweep: contradictions=$C ═══"

      # ── Stop previous hatchery ──
      if [ -n "$HATCHERY_PID" ]; then
        kill "$HATCHERY_PID" 2>/dev/null || true
        wait "$HATCHERY_PID" 2>/dev/null || true
        HATCHERY_PID=""
      fi

      # ── Reset DB/NATS ──
      node --loader ts-node/esm scripts/reset-e2e.ts 2>/dev/null || true
      node --loader ts-node/esm scripts/ensure-schema.ts 2>/dev/null
      node --loader ts-node/esm scripts/ensure-stream.ts 2>/dev/null

      # ── Start hatchery ──
      if [ "$RUN_SWARM" = 1 ]; then
        : > "$LOG_DIR/swarm-exp-hatchery.log"
        AGENT_ROLE=hatchery AGENT_ID=hatchery-exp node --loader ts-node/esm src/swarm.ts \
          >> "$LOG_DIR/swarm-exp-hatchery.log" 2>&1 &
        HATCHERY_PID=$!
        MITL_PORT="${MITL_PORT:-3001}"
        for i in $(seq 1 30); do
          curl -sf "http://127.0.0.1:${MITL_PORT}/health" >/dev/null 2>&1 && break
          [ "$i" = 30 ] && { echo "[Exp] MITL not ready"; exit 1; }
          sleep 1
        done
      fi

      RESOLVE_OPT="--resolve-at=5,6,7"
      export CONTRADICTIONS="$C"
      run_single_experiment "exp1" "--contradictions=$C"

      echo "[Exp] Collecting exp1-sweep (contradictions=$C) results..."
      node --loader ts-node/esm scripts/collect-experiment-results.ts "exp1" 2>/dev/null || true
    done
    unset CONTRADICTIONS
    echo ""
    echo "[Exp] Exp1-Sweep complete. See docs/experiments/exp1/results/"
    exit 0
    ;;
  exp-ab)
    ROUNDS="${ROUNDS:-7}"
    echo "[Exp] Exp-AB: Scalar↔Vector finality A/B comparison"
    echo "[Exp] Phase 1: Scalar (per_dimension_finality.enabled: false)"
    FINALITY_YAML="finality.yaml"

    # ── Phase A: Scalar finality ──
    # Temporarily disable vector finality
    sed -i.exp-ab-bak 's/^  enabled: true/  enabled: false/' "$FINALITY_YAML"

    if [ -n "$HATCHERY_PID" ]; then
      kill "$HATCHERY_PID" 2>/dev/null || true
      wait "$HATCHERY_PID" 2>/dev/null || true
      HATCHERY_PID=""
    fi

    node --loader ts-node/esm scripts/reset-e2e.ts 2>/dev/null || true
    node --loader ts-node/esm scripts/ensure-schema.ts 2>/dev/null
    node --loader ts-node/esm scripts/ensure-stream.ts 2>/dev/null

    if [ "$RUN_SWARM" = 1 ]; then
      : > "$LOG_DIR/swarm-exp-hatchery.log"
      AGENT_ROLE=hatchery AGENT_ID=hatchery-exp node --loader ts-node/esm src/swarm.ts \
        >> "$LOG_DIR/swarm-exp-hatchery.log" 2>&1 &
      HATCHERY_PID=$!
      MITL_PORT="${MITL_PORT:-3001}"
      for i in $(seq 1 30); do
        curl -sf "http://127.0.0.1:${MITL_PORT}/health" >/dev/null 2>&1 && break
        [ "$i" = 30 ] && { echo "[Exp] MITL not ready"; exit 1; }
        sleep 1
      done
    fi

    RESOLVE_OPT="--resolve-at=5,6,7"
    CONTRADICT="${CONTRADICTIONS:-3}"
    run_single_experiment "exp1" "--contradictions=$CONTRADICT"

    # Collect scalar results
    TS_AB=$(date -u +%Y-%m-%dT%H-%M-%S)
    AB_DIR="docs/experiments/exp-ab/results/$TS_AB"
    mkdir -p "$AB_DIR/scalar"
    node --loader ts-node/esm scripts/collect-experiment-results.ts "exp-ab" "$AB_DIR/scalar" 2>/dev/null || true

    echo ""
    echo "[Exp] Phase 2: Vector (per_dimension_finality.enabled: true)"

    # ── Phase B: Vector finality ──
    # Restore vector finality
    mv "$FINALITY_YAML.exp-ab-bak" "$FINALITY_YAML"

    if [ -n "$HATCHERY_PID" ]; then
      kill "$HATCHERY_PID" 2>/dev/null || true
      wait "$HATCHERY_PID" 2>/dev/null || true
      HATCHERY_PID=""
    fi

    node --loader ts-node/esm scripts/reset-e2e.ts 2>/dev/null || true
    node --loader ts-node/esm scripts/ensure-schema.ts 2>/dev/null
    node --loader ts-node/esm scripts/ensure-stream.ts 2>/dev/null

    if [ "$RUN_SWARM" = 1 ]; then
      : > "$LOG_DIR/swarm-exp-hatchery.log"
      AGENT_ROLE=hatchery AGENT_ID=hatchery-exp node --loader ts-node/esm src/swarm.ts \
        >> "$LOG_DIR/swarm-exp-hatchery.log" 2>&1 &
      HATCHERY_PID=$!
      MITL_PORT="${MITL_PORT:-3001}"
      for i in $(seq 1 30); do
        curl -sf "http://127.0.0.1:${MITL_PORT}/health" >/dev/null 2>&1 && break
        [ "$i" = 30 ] && { echo "[Exp] MITL not ready"; exit 1; }
        sleep 1
      done
    fi

    run_single_experiment "exp1" "--contradictions=$CONTRADICT"

    mkdir -p "$AB_DIR/vector"
    node --loader ts-node/esm scripts/collect-experiment-results.ts "exp-ab" "$AB_DIR/vector" 2>/dev/null || true

    echo ""
    echo "[Exp] Exp-AB complete. Running analysis..."
    node --loader ts-node/esm scripts/analyze-scalar-vs-vector.ts "$AB_DIR" 2>/dev/null || true
    echo "[Exp] Done. See $AB_DIR"
    exit 0
    ;;
  *)
    echo "[Exp] Unknown experiment: $EXP_ID. Use exp1, exp2, exp3, exp4, exp5, exp6, exp7, exp8, exp9, exp1-sweep, exp-ab, insurance, noisy, financial, demo-baseline."
    exit 1
    ;;
esac

# ── Step 3: Collect results ──────────────────────────────────────────────────
echo ""
echo "[Exp] Collecting results..."
node --loader ts-node/esm scripts/collect-experiment-results.ts "$EXP_ID"
echo "[Exp] Done. See docs/experiments/$EXP_ID/results/"
