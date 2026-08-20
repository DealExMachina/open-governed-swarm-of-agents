#!/usr/bin/env bash
# Full Liquid NLI 350M pipeline on Hugging Face Jobs — L4 GPU.
#
# Stages: MNLI probe (15k) → domain (1k corpus) → refine → push to Hub.
# Uses the same 1k domain dataset as the 230M v3 L4 run.
#
# Usage:
#   bash scripts/run-hf-l4-full-pipeline-350m.sh upload
#   bash scripts/run-hf-l4-full-pipeline-350m.sh submit
#   bash scripts/run-hf-l4-full-pipeline-350m.sh upload-and-submit
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCRIPT_PATH="model_evals/liquidai-encoders/hf_jobs/train_liquid_nli_350m_l4.py"
TRAIN_JSONL="model_evals/liquidai-encoders/dataset/train.jsonl"
EVAL_JSONL="model_evals/liquidai-encoders/dataset/eval.jsonl"

HF_SCRIPT_REPO="${HF_SCRIPT_REPO:-jeanbaptdzd/liquid-nli-scripts}"
HF_DATA_REPO="${HF_DATA_REPO:-jeanbaptdzd/liquid-nli-domain-1k}"
HF_HUB_MODEL="${HF_HUB_MODEL:-jeanbaptdzd/lfm25-nli-350m-v1k-calibrated-l4}"
HF_SCRIPT_URL="${HF_SCRIPT_URL:-https://huggingface.co/${HF_SCRIPT_REPO}/resolve/main/train_liquid_nli_350m_l4.py}"

FLAVOR="${FLAVOR:-l4x1}"
TIMEOUT="${TIMEOUT:-6h}"
PROBE_SAMPLES="${LIQUID_PROBE_SAMPLES:-15000}"
TRAIN_BATCH="${LIQUID_TRAIN_BATCH:-8}"
GRAD_ACCUM="${LIQUID_GRAD_ACCUM:-4}"

if [[ -z "${HF_TOKEN:-}" ]]; then
  if command -v hf >/dev/null 2>&1 && hf auth whoami >/dev/null 2>&1; then
    TOKEN_FILE="${HF_HOME:-$HOME/.cache/huggingface}/token"
    if [[ -f "$TOKEN_FILE" ]]; then
      HF_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
      export HF_TOKEN
    fi
  fi
fi

if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "ERROR: HF_TOKEN is not set. Run: hf auth login  or  export HF_TOKEN=hf_..."
  exit 1
fi

if ! command -v hf >/dev/null 2>&1; then
  echo "ERROR: hf CLI not found."
  exit 1
fi

upload_assets() {
  echo "== Upload 350M training script to ${HF_SCRIPT_REPO} =="
  hf repo create "$HF_SCRIPT_REPO" --repo-type model --exist-ok
  hf upload "$HF_SCRIPT_REPO" "$SCRIPT_PATH" train_liquid_nli_350m_l4.py \
    --commit-message "Liquid NLI 350M full pipeline L4 script"

  echo "== Ensure domain dataset on ${HF_DATA_REPO} =="
  hf repo create "$HF_DATA_REPO" --repo-type dataset --exist-ok
  hf upload "$HF_DATA_REPO" "$TRAIN_JSONL" train.jsonl --repo-type dataset --commit-message "Domain train split v1k"
  hf upload "$HF_DATA_REPO" "$EVAL_JSONL" eval.jsonl --repo-type dataset --commit-message "Domain eval split v1k"
  hf upload "$HF_DATA_REPO" model_evals/liquidai-encoders/dataset/split_manifest.json split_manifest.json \
    --repo-type dataset --commit-message "Split manifest"

  echo "Script:  $HF_SCRIPT_URL"
  echo "Dataset: https://huggingface.co/datasets/${HF_DATA_REPO}"
}

submit_job() {
  echo "== HF Jobs: L4 full Liquid NLI 350M pipeline =="
  echo "Flavor: $FLAVOR  Timeout: $TIMEOUT"
  echo "Model:  LiquidAI/LFM2.5-Encoder-350M"
  echo "Hub:    $HF_HUB_MODEL"
  echo "Dataset: $HF_DATA_REPO"
  hf jobs uv run \
    --flavor "$FLAVOR" \
    --timeout "$TIMEOUT" \
    --secrets HF_TOKEN \
    --env "HF_HUB_MODEL=${HF_HUB_MODEL}" \
    --env "HF_DATA_REPO=${HF_DATA_REPO}" \
    --env "LIQUID_NLI_MODEL=LiquidAI/LFM2.5-Encoder-350M" \
    --env "LIQUID_PROBE_SAMPLES=${PROBE_SAMPLES}" \
    --env "LIQUID_TRAIN_BATCH=${TRAIN_BATCH}" \
    --env "LIQUID_GRAD_ACCUM=${GRAD_ACCUM}" \
    "$HF_SCRIPT_URL"
  echo ""
  echo "Monitor: hf jobs ps --all"
  echo "Pull when done:"
  echo "  hf download ${HF_HUB_MODEL} --local-dir workers/facts-worker/checkpoints/nli-domain-350m-v1k-calibrated"
}

case "${1:-submit}" in
  upload) upload_assets ;;
  upload-and-submit)
    upload_assets
    submit_job
    ;;
  submit) submit_job ;;
  *)
    echo "Usage: $0 [upload|submit|upload-and-submit]"
    exit 1
    ;;
esac
