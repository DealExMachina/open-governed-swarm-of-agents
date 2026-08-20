#!/usr/bin/env bash
# Start Liquid finetuned NLI worker in Docker and run the gold harness (fail-closed).
#
# Usage:
#   ./scripts/run-liquid-nli-gold-eval.sh <checkpoint_dir> <out_json> [container_name] [port]
#
# Example:
#   ./scripts/run-liquid-nli-gold-eval.sh \
#     workers/facts-worker/checkpoints/nli-domain-v2-calibrated \
#     model_evals/liquidai-encoders/phase1e-refine-gold-minconf077.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/wait-for-facts-worker-nli.sh
source "$ROOT/scripts/wait-for-facts-worker-nli.sh"

CHECKPOINT="${1:?checkpoint dir required}"
OUT_JSON="${2:?output json path required}"
CONTAINER="${3:-asg-facts-liquid-gold}"
PORT="${4:-8016}"
MIN_CONF="${EQUIV_MIN_CONFIDENCE:-0.77}"
USE_LOCAL="${LIQUID_GOLD_EVAL_LOCAL:-0}"
LOCAL_PORT="${LIQUID_GOLD_EVAL_LOCAL_PORT:-$PORT}"

# Resolve checkpoint path inside container mount (/app = workers/facts-worker)
if [[ "$CHECKPOINT" = /* ]]; then
  rel="${CHECKPOINT#"$ROOT/workers/facts-worker"}"
  CKPT_CONTAINER="/app${rel}"
else
  ck="${CHECKPOINT#workers/facts-worker/}"
  CKPT_CONTAINER="/app/${ck}"
fi
echo "Checkpoint (container): ${CKPT_CONTAINER}"

cd "$ROOT"

if [[ "$USE_LOCAL" == "1" ]]; then
  VENV="${ROOT}/model_evals/liquidai-encoders/.venv"
  if [[ ! -x "$VENV/bin/uvicorn" ]]; then
    echo "ERROR: LIQUID_GOLD_EVAL_LOCAL=1 but $VENV/bin/uvicorn missing" >&2
    exit 1
  fi
  CKPT_ABS="$ROOT/workers/facts-worker/${CHECKPOINT#workers/facts-worker/}"
  if [[ "$CHECKPOINT" = /* ]]; then CKPT_ABS="$CHECKPOINT"; fi
  echo "Starting local facts-worker on port ${LOCAL_PORT} (no Docker pip install) …"
  # shellcheck disable=SC1091
  source "$VENV/bin/activate"
  pip install -q fastapi uvicorn pydantic openai python-dotenv 2>/dev/null || true
  SKIP_NLI=0 NLI_BACKEND=liquidai LIQUID_NLI_MODE=finetuned \
    LIQUID_NLI_CHECKPOINT="$CKPT_ABS" LIQUID_NLI_DEVICE=cpu \
    OPENAI_API_KEY="${OPENAI_API_KEY:-sk-dummy}" \
    uvicorn app:app --host 127.0.0.1 --port "$LOCAL_PORT" \
    --app-dir "$ROOT/workers/facts-worker" &
  UV_PID=$!
  trap 'kill "$UV_PID" 2>/dev/null || true' EXIT
  wait_for_facts_worker_nli "http://127.0.0.1:${LOCAL_PORT}" 120 3
  WORKER_URL="http://127.0.0.1:${LOCAL_PORT}"
else
  docker rm -f "$CONTAINER" 2>/dev/null || true
  docker compose run -d --name "$CONTAINER" --no-deps \
    -p "${PORT}:8010" \
    -v "$ROOT/workers/facts-worker:/app" \
    -v "${HOME}/.cache/huggingface:/root/.cache/huggingface" \
    -e SKIP_NLI=0 \
    -e NLI_BACKEND=liquidai \
    -e LIQUID_NLI_MODE=finetuned \
    -e "LIQUID_NLI_CHECKPOINT=${CKPT_CONTAINER}" \
    -e LIQUID_NLI_DEVICE=cpu \
    -e "LIQUID_NLI_MODEL=${LIQUID_NLI_MODEL:-LiquidAI/LFM2.5-Encoder-230M}" \
    -e "OPENAI_API_KEY=${OPENAI_API_KEY:-sk-dummy}" \
    -e PYTHONUNBUFFERED=1 \
    facts-worker \
    sh -c "pip install -q fastapi uvicorn pydantic torch transformers sentence-transformers openai python-dotenv && uvicorn app:app --host 0.0.0.0 --port 8010"

  wait_for_facts_worker_nli "http://127.0.0.1:${PORT}" 360 5
  WORKER_URL="http://127.0.0.1:${PORT}"
fi

FACTS_WORKER_URL="$WORKER_URL" \
  EQUIV_MIN_CONFIDENCE="$MIN_CONF" \
  npx tsx scripts/eval-nli-gold-set.ts --out="$OUT_JSON"
