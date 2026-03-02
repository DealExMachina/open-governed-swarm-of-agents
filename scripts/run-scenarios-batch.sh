#!/usr/bin/env bash
# Run multiple experiment scenarios, each with N runs. Collects results under a
# single top-level batch dir and prints a short consistency summary.
#
# Usage:
#   bash scripts/run-scenarios-batch.sh [n_runs]
#
# Default n_runs=2. Scenarios (hardcoded):
#   - exp1: contradictions=0, 1, 3, 5 (4 scenarios)
#   - exp3: pattern=spike-and-drop, oscillating, stale (3 scenarios)
#
# Results:
#   docs/experiments/_batch_<timestamp>/
#     exp1-contradictions0/run-1..run-N, summary.json
#     exp1-contradictions1/...
#     ...
#     exp3-stale/...
#
# Then prints a short summary (finality_state distribution, n_runs) per scenario.
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi

N_RUNS="${1:-2}"

RUNNER="pnpm"
[ -f pnpm-lock.yaml ] || RUNNER="npm"

BATCH_TS="$(date -u +%Y-%m-%dT%H-%M-%S)-scenarios-n${N_RUNS}"
BATCH_TOP="docs/experiments/_batch_${BATCH_TS}"
mkdir -p "$BATCH_TOP"

# Scenario list: (exp_id, options, label)
run_scenario() {
  local exp_id="$1"
  local opts="$2"
  local label="$3"
  echo ""
  echo "========================================"
  echo "  Scenario: ${label} (${exp_id} ${opts}) x ${N_RUNS} runs"
  echo "========================================"
  bash scripts/run-experiment-batch.sh "$exp_id" "$N_RUNS" $opts

  local latest
  latest=$(ls -td docs/experiments/"${exp_id}"/results/*-batch-n"${N_RUNS}" 2>/dev/null | head -1)
  if [ -n "$latest" ] && [ -d "$latest" ]; then
    cp -r "$latest" "${BATCH_TOP}/${label}"
    echo "[Scenarios] Copied ${latest} to ${BATCH_TOP}/${label}"
  else
    echo "[Scenarios] Warning: no batch dir found for ${label}"
  fi
}

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Multi-scenario batch: ${N_RUNS} runs per scenario              "
echo "║  Output: ${BATCH_TOP}"
echo "╚══════════════════════════════════════════════════════════════╝"

# Exp1: varying contradiction density
run_scenario "exp1" "--contradictions=0 --rounds=5" "exp1-contradictions0"
run_scenario "exp1" "--contradictions=1 --rounds=5" "exp1-contradictions1"
run_scenario "exp1" "--contradictions=3 --rounds=7 --resolve-at=5" "exp1-contradictions3"
run_scenario "exp1" "--contradictions=5 --rounds=7 --resolve-at=5" "exp1-contradictions5"

# Exp3: adversarial patterns
run_scenario "exp3" "--pattern=spike-and-drop --rounds=4" "exp3-spike-and-drop"
run_scenario "exp3" "--pattern=oscillating --rounds=5" "exp3-oscillating"
run_scenario "exp3" "--pattern=stale --rounds=3" "exp3-stale"

echo ""
echo "──── Consistency summary ────"
for dir in "${BATCH_TOP}"/exp*-*/; do
  [ -d "$dir" ] || continue
  label=$(basename "$dir")
  summary="${dir}summary.json"
  if [ -f "$summary" ]; then
    if command -v jq >/dev/null 2>&1; then
      n=$(jq -r '.n_runs // "?"' "$summary")
      finality=$(jq -r '.finality_state_distribution // {} | to_entries | map("\(.key):\(.value)") | join(", ")' "$summary")
      echo "  ${label}: n_runs=${n}  finality={ ${finality} }"
    else
      echo "  ${label}: see ${summary}"
    fi
  else
    echo "  ${label}: no summary.json"
  fi
done

echo ""
echo "========================================"
echo "  Scenarios batch complete: ${BATCH_TOP}"
echo "  Each scenario has run-1..run-${N_RUNS} and summary.json"
echo "========================================"
