#!/bin/bash
# Run all E1-E7 propagation layer experiments.
# Usage: bash scripts/run-propagation-experiments.sh [--runs=N]
set -euo pipefail

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     Propagation Layer Experiments E1-E7                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo

SCRIPTS=(
  "scripts/propagation-e1-error-amplification.ts"
  "scripts/propagation-e2-contradiction-time.ts"
  "scripts/propagation-e3-oscillation-bound.ts"
  "scripts/propagation-e4-communication-cost.ts"
  "scripts/propagation-e5-topology-sensitivity.ts"
  "scripts/propagation-e6-partial-order.ts"
  "scripts/propagation-e7-iss-calibration.ts"
)

PASSED=0
FAILED=0

for script in "${SCRIPTS[@]}"; do
  id=$(basename "$script" | sed 's/propagation-//' | sed 's/-.*//' | tr '[:lower:]' '[:upper:]')
  echo "=== ${id} ==="
  if npx tsx "$script" "$@"; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
  fi
  echo
done

echo "══════════════════════════════════════════════════════════════"
echo "Results: ${PASSED} passed, ${FAILED} failed out of ${#SCRIPTS[@]}"
echo "══════════════════════════════════════════════════════════════"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
