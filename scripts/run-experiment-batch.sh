#!/usr/bin/env bash
# Batch runner: executes an experiment N times, collects results into run-1..N
# subdirectories, then runs the analysis script to compute aggregates.
#
# Usage:
#   bash scripts/run-experiment-batch.sh <exp_id> <n_runs> [experiment options...]
#
# Examples:
#   bash scripts/run-experiment-batch.sh exp1 3 --contradictions=3
#   bash scripts/run-experiment-batch.sh exp3 3 --pattern=spike-and-drop --rounds=4
#   FINALITY_GATES_DISABLED=1 bash scripts/run-experiment-batch.sh exp3 3 --pattern=spike-and-drop
#
# Results:
#   docs/experiments/<exp_id>/results/<batch_ts>/run-1/  (first run)
#   docs/experiments/<exp_id>/results/<batch_ts>/run-2/  (second run)
#   docs/experiments/<exp_id>/results/<batch_ts>/run-N/  (Nth run)
#   docs/experiments/<exp_id>/results/<batch_ts>/summary.json  (aggregated stats)
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi

EXP_ID="${1:?Usage: run-experiment-batch.sh <exp_id> <n_runs> [options...]}"
N_RUNS="${2:?Usage: run-experiment-batch.sh <exp_id> <n_runs> [options...]}"
shift 2

BATCH_TS="$(date -u +%Y-%m-%dT%H-%M-%S)-batch-n${N_RUNS}"
BATCH_DIR="docs/experiments/${EXP_ID}/results/${BATCH_TS}"
mkdir -p "$BATCH_DIR"

echo "========================================"
echo "  Batch: ${EXP_ID} x ${N_RUNS} runs"
echo "  Output: ${BATCH_DIR}"
echo "  Options: $*"
echo "========================================"

for i in $(seq 1 "$N_RUNS"); do
  echo ""
  echo "──── Run ${i}/${N_RUNS} ────"
  RUN_DIR="${BATCH_DIR}/run-${i}"
  mkdir -p "$RUN_DIR"

  bash scripts/run-experiment.sh "$EXP_ID" "$@" 2>&1 | tee "${RUN_DIR}/run.log"

  LATEST=$(ls -td docs/experiments/"${EXP_ID}"/results/202* 2>/dev/null | head -1)
  if [ -n "$LATEST" ] && [ "$LATEST" != "$BATCH_DIR" ] && [ -f "${LATEST}/metadata.json" ]; then
    cp "${LATEST}"/*.json "$RUN_DIR/" 2>/dev/null || true
    echo "[Batch] Copied results from ${LATEST} to ${RUN_DIR}"
  else
    echo "[Batch] Warning: no results found for run ${i}"
  fi
done

echo ""
echo "──── Analysis ────"
node --loader ts-node/esm scripts/analyze-experiment.ts "$BATCH_DIR" 2>&1 || echo "[Batch] Analysis script failed (may not exist yet)"

echo ""
echo "========================================"
echo "  Batch complete: ${BATCH_DIR}"
echo "  ${N_RUNS} runs collected"
echo "========================================"
