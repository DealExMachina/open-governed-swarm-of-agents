#!/usr/bin/env bash
# Zero-shot LFM2.5-Encoder-230M vs DeBERTa v3 large — same NLI gold harness.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/wait-for-facts-worker-nli.sh
source "$ROOT/scripts/wait-for-facts-worker-nli.sh"
cd "$ROOT"

OUT_DIR="model_evals/liquidai-encoders"
WORKER_URL="${FACTS_WORKER_URL:-http://127.0.0.1:8010}"
PORT="${LIQUID_WORKER_PORT:-8011}"

echo "== Phase 1 zero-shot: start Liquid NLI worker on :${PORT} =="
docker compose run -d --name asg-facts-liquid-nli --no-deps \
  -p "${PORT}:8010" \
  -v "$ROOT/workers/facts-worker:/app" \
  -v "${HOME}/.cache/huggingface:/root/.cache/huggingface" \
  -e SKIP_NLI=0 \
  -e NLI_BACKEND=liquidai \
  -e LIQUID_NLI_MODE=zero_shot \
  -e LIQUID_NLI_MODEL="${LIQUID_NLI_MODEL:-LiquidAI/LFM2.5-Encoder-230M}" \
  -e LIQUID_NLI_DEVICE=cpu \
  -e OPENAI_API_KEY="${OPENAI_API_KEY:-sk-dummy}" \
  facts-worker \
  sh -c "pip install -q fastapi uvicorn pydantic torch transformers sentence-transformers 2>/dev/null; uvicorn app:app --host 0.0.0.0 --port 8010" \
  2>/dev/null || docker start asg-facts-liquid-nli 2>/dev/null || true

echo "Waiting for Liquid encoder load (first run downloads weights)…"
wait_for_facts_worker_nli "http://127.0.0.1:${PORT}" 120 5 || {
  docker logs asg-facts-liquid-nli 2>&1 | tail -30
  exit 1
}

echo "== Gold set eval =="
START=$(date +%s)
FACTS_WORKER_URL="http://127.0.0.1:${PORT}" npx tsx scripts/eval-nli-gold-set.ts \
  --out="$OUT_DIR/phase1-lfm-zero-shot-gold.json" || true
END=$(date +%s)
echo "Wall-clock: $((END - START))s"

echo "== Held-out eval =="
FACTS_WORKER_URL="http://127.0.0.1:${PORT}" npx tsx scripts/eval-nli-gold-set.ts \
  --gold=test/fixtures/nli-held-out.yaml \
  --out="$OUT_DIR/phase1-lfm-zero-shot-held-out.json" || true

echo "== Comparison report =="
npx tsx scripts/compare-nli-eval-reports.ts \
  "$OUT_DIR/baseline-deberta-v3-large-gold.json" \
  "$OUT_DIR/phase1-lfm-zero-shot-gold.json" \
  --out="$OUT_DIR/phase1-zero-shot-vs-deberta.md"

echo "Done. See $OUT_DIR/phase1-zero-shot-vs-deberta.md"
