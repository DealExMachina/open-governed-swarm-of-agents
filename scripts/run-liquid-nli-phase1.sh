#!/usr/bin/env bash
# Phase 1 — Liquid LFM2.5-Encoder NLI probe vs DeBERTa baseline.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WORKER_URL="${FACTS_WORKER_URL:-http://127.0.0.1:8010}"
OUT_DIR="model_evals/liquidai-encoders"
BASELINE_MANIFEST="$OUT_DIR/baseline-deberta-v3-large-manifest.json"

step_train() {
  echo "== Step 1: MNLI probe fine-tune (LFM2.5-Encoder-230M) =="
  docker compose run --rm --no-deps \
    -v "$ROOT:/repo" \
    -v "${HOME}/.cache/huggingface:/root/.cache/huggingface" \
    facts-worker \
    sh -c "pip install -q -r requirements-full.txt && python /repo/model_evals/liquidai-encoders/train_mnli_probe.py \
      --max-samples ${LIQUID_TRAIN_SAMPLES:-3000} \
      --epochs ${LIQUID_TRAIN_EPOCHS:-1} \
      --batch-size ${LIQUID_TRAIN_BATCH:-8}"
}

step_worker_liquid() {
  echo "== Step 2: Restart facts-worker with NLI_BACKEND=liquidai =="
  export SKIP_NLI=0
  export NLI_BACKEND=liquidai
  export LIQUID_NLI_MODEL="${LIQUID_NLI_MODEL:-LiquidAI/LFM2.5-Encoder-230M}"
  docker compose up -d --force-recreate facts-worker
  sleep 5
  curl -sf "$WORKER_URL/health" | python3 -m json.tool
}

step_eval() {
  local tag="$1"
  local out="$OUT_DIR/phase1-${tag}-gold.json"
  echo "== Eval gold set -> $out =="
  FACTS_WORKER_URL="$WORKER_URL" npx tsx scripts/eval-nli-gold-set.ts --out="$out"
  FACTS_WORKER_URL="$WORKER_URL" npx tsx scripts/eval-nli-gold-set.ts \
    --gold=test/fixtures/nli-held-out.yaml \
    --out="$OUT_DIR/phase1-${tag}-held-out.json"
}

case "${1:-all}" in
  train) step_train ;;
  worker) step_worker_liquid ;;
  eval-liquid) step_eval "lfm-mnli-probe" ;;
  all)
    step_train
    step_worker_liquid
    step_eval "lfm-mnli-probe"
    ;;
  *)
    echo "Usage: $0 [train|worker|eval-liquid|all]"
    exit 1
    ;;
esac
