#!/usr/bin/env bash
# 350M L4 retune — MPS-aligned recipe (fixes over-aggressive L4 refine).
#
# Root cause of L4 < MPS on gold: refine wd=0.01 + 2x domain LR → train_loss 0.001
# on refine (MPS refine loss ~0.06). This job matches MPS hyperparams on L4.
#
# Mode A (default): refine-only from MPS domain ckpt on Hub (fastest, ~2 min)
# Mode B: full pipeline with MPS recipe env vars
#
# Usage:
#   bash scripts/run-hf-l4-350m-mps-recipe.sh upload-mps-domain   # once
#   bash scripts/run-hf-l4-350m-mps-recipe.sh submit             # refine-only
#   MODE=full bash scripts/run-hf-l4-350m-mps-recipe.sh upload-and-submit
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCRIPT_PATH="model_evals/liquidai-encoders/hf_jobs/train_liquid_nli_350m_l4.py"
DOMAIN_CKPT="${ROOT}/workers/facts-worker/checkpoints/nli-domain-350m-v1"
PROBE_CKPT="${ROOT}/workers/facts-worker/checkpoints/nli-mnli-probe-350m"

HF_SCRIPT_REPO="${HF_SCRIPT_REPO:-jeanbaptdzd/liquid-nli-scripts}"
HF_DATA_REPO="${HF_DATA_REPO:-jeanbaptdzd/liquid-nli-domain-1k}"
HF_DOMAIN_REPO="${HF_DOMAIN_REPO:-jeanbaptdzd/lfm25-nli-350m-mps-domain-1k}"
HF_PROBE_REPO="${HF_PROBE_REPO:-jeanbaptdzd/lfm25-nli-350m-mps-probe}"
HF_HUB_MODEL="${HF_HUB_MODEL:-jeanbaptdzd/lfm25-nli-350m-v1k-mps-recipe-l4}"
HF_SCRIPT_URL="${HF_SCRIPT_URL:-https://huggingface.co/${HF_SCRIPT_REPO}/resolve/main/train_liquid_nli_350m_l4.py}"

MODE="${MODE:-refine-only}"
FLAVOR="${FLAVOR:-l4x1}"
TIMEOUT="${TIMEOUT:-2h}"

if [[ -z "${HF_TOKEN:-}" ]]; then
  if command -v hf >/dev/null 2>&1 && hf auth whoami >/dev/null 2>&1; then
    TOKEN_FILE="${HF_HOME:-$HOME/.cache/huggingface}/token"
    [[ -f "$TOKEN_FILE" ]] && HF_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")" && export HF_TOKEN
  fi
fi
[[ -n "${HF_TOKEN:-}" ]] || { echo "ERROR: HF_TOKEN missing" >&2; exit 1; }
command -v hf >/dev/null 2>&1 || { echo "ERROR: hf CLI missing" >&2; exit 1; }

upload_script() {
  hf repo create "$HF_SCRIPT_REPO" --repo-type model --exist-ok
  hf upload "$HF_SCRIPT_REPO" "$SCRIPT_PATH" train_liquid_nli_350m_l4.py \
    --commit-message "350M L4 recipe env tuning + refine-only mode"
}

upload_mps_domain() {
  [[ -d "$DOMAIN_CKPT" ]] || { echo "ERROR: MPS domain ckpt missing at $DOMAIN_CKPT" >&2; exit 1; }
  hf repo create "$HF_DOMAIN_REPO" --repo-type model --exist-ok
  hf upload "$HF_DOMAIN_REPO" "$DOMAIN_CKPT" . --commit-message "350M MPS domain stage (1k corpus)"
  echo "Domain checkpoint: https://huggingface.co/${HF_DOMAIN_REPO}"
}

upload_mps_probe() {
  [[ -d "$PROBE_CKPT" ]] || { echo "ERROR: MPS probe missing at $PROBE_CKPT" >&2; exit 1; }
  hf repo create "$HF_PROBE_REPO" --repo-type model --exist-ok
  hf upload "$HF_PROBE_REPO" "$PROBE_CKPT" . --commit-message "350M MPS SNLI probe (4k)"
}

submit_job() {
  echo "== 350M L4 MPS-recipe job (mode=$MODE) =="
  ENV_ARGS=(
    --env "HF_HUB_MODEL=${HF_HUB_MODEL}"
    --env "HF_DATA_REPO=${HF_DATA_REPO}"
    --env "LIQUID_NLI_MODEL=LiquidAI/LFM2.5-Encoder-350M"
    --env "LIQUID_RECIPE=mps-aligned"
    --env "LIQUID_REFINE_WD=0.1"
    --env "LIQUID_REFINE_LR=5e-6"
    --env "LIQUID_TRAIN_BATCH=4"
    --env "LIQUID_GRAD_ACCUM=4"
  )
  if [[ "$MODE" == "refine-only" ]]; then
    ENV_ARGS+=(--env "HF_DOMAIN_CKPT_REPO=${HF_DOMAIN_REPO}")
  else
    ENV_ARGS+=(
      --env "LIQUID_SKIP_PROBE=1"
      --env "HF_PROBE_REPO=${HF_PROBE_REPO}"
      --env "LIQUID_DOMAIN_LR=1e-5"
      --env "LIQUID_SNLI_CAP=500"
      --env "LIQUID_SNLI_MIX=0.2"
      --env "LIQUID_PROBE_SAMPLES=4000"
    )
  fi
  hf jobs uv run \
    --flavor "$FLAVOR" \
    --timeout "$TIMEOUT" \
    --secrets HF_TOKEN \
    "${ENV_ARGS[@]}" \
    "$HF_SCRIPT_URL"
  echo "Hub output: $HF_HUB_MODEL"
}

case "${1:-submit}" in
  upload-mps-domain) upload_mps_domain ;;
  upload-mps-probe) upload_mps_probe ;;
  upload-script) upload_script ;;
  submit) submit_job ;;
  upload-and-submit)
    upload_script
    if [[ "$MODE" == "refine-only" ]]; then upload_mps_domain; else upload_mps_probe; upload_mps_domain; fi
    submit_job
    ;;
  *)
    echo "Usage: $0 [upload-mps-domain|upload-mps-probe|upload-script|submit|upload-and-submit]"
    exit 1
    ;;
esac
