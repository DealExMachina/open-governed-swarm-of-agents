#!/usr/bin/env bash
# Full protocol for Experiment 1 (issue #12): all four contradiction densities.
# Runs exp1 with c=0, 1, 3, 5; 7 rounds; resolve at 5,6,7.
# Usage: bash scripts/run-exp1-full-protocol.sh
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi

echo "[Exp1 full protocol] Running 4 scenarios: contradictions=0, 1, 3, 5 (7 rounds, resolve-at=5,6,7)"
echo ""

for c in 0 1 3 5; do
  echo "========================================"
  echo "  Exp1 contradictions=$c"
  echo "========================================"
  bash scripts/run-experiment.sh exp1 --contradictions=$c --rounds=7 --resolve-at=5,6,7
  echo ""
done

echo "========================================"
echo "  Exp1 full protocol complete"
echo "  Results: docs/experiments/exp1/results/<timestamp> (one dir per run)"
echo "  Compare V(t) and gate satisfaction across c=0,1,3,5"
echo "========================================"
