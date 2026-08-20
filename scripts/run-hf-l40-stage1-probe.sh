#!/usr/bin/env bash
# Submit Stage 1 SNLI probe (8000 samples) on Hugging Face Jobs — L40 GPU.
#
# Prerequisites:
#   - Hugging Face Pro/Team/Enterprise (Jobs are paid)
#   - hf CLI: curl -LsSf https://hf.co/cli/install.sh | bash
#   - HF_TOKEN with write access: hf auth login  (or export HF_TOKEN=hf_...)
#   - Upload hf_jobs/train_mnli_probe_l40.py to a Hub repo (see below)
#
# You do NOT need a Space — Jobs run on managed GPU infrastructure.
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCRIPT_PATH="model_evals/liquidai-encoders/hf_jobs/train_mnli_probe_l40.py"
HF_HUB_MODEL="${HF_HUB_MODEL:-jeanbaptdzd/lfm25-nli-mnli-probe-l40}"
HF_SCRIPT_REPO="${HF_SCRIPT_REPO:-jeanbaptdzd/liquid-nli-scripts}"
HF_SCRIPT_URL="${HF_SCRIPT_URL:-https://huggingface.co/${HF_SCRIPT_REPO}/resolve/main/train_mnli_probe_l40.py}"
FLAVOR="${FLAVOR:-l40sx1}"
TIMEOUT="${TIMEOUT:-2h}"
LIQUID_TRAIN_SAMPLES="${LIQUID_TRAIN_SAMPLES:-8000}"

if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "ERROR: HF_TOKEN is not set. Run: hf auth login  or  export HF_TOKEN=hf_..."
  exit 1
fi

if ! command -v hf >/dev/null 2>&1; then
  echo "ERROR: hf CLI not found. Install: curl -LsSf https://hf.co/cli/install.sh | bash"
  exit 1
fi

upload_script() {
  echo "== Upload training script to ${HF_SCRIPT_REPO} =="
  hf repo create "$HF_SCRIPT_REPO" --repo-type model --exist-ok
  hf upload "$HF_SCRIPT_REPO" "$SCRIPT_PATH" train_mnli_probe_l40.py --commit-message "Stage 1 L40 probe script"
  echo "Script URL: $HF_SCRIPT_URL"
}

case "${1:-submit}" in
  upload)
    upload_script
    ;;
  submit)
    echo "== HF Jobs: L40 Stage 1 probe (${LIQUID_TRAIN_SAMPLES} SNLI samples) =="
    echo "Flavor: $FLAVOR  Timeout: $TIMEOUT  Hub model: $HF_HUB_MODEL"
    hf jobs uv run \
      --flavor "$FLAVOR" \
      --timeout "$TIMEOUT" \
      --secrets HF_TOKEN \
      --env "HF_HUB_MODEL=${HF_HUB_MODEL}" \
      --env "LIQUID_TRAIN_SAMPLES=${LIQUID_TRAIN_SAMPLES}" \
      --env "LIQUID_TRAIN_BATCH=16" \
      --env "LIQUID_GRAD_ACCUM=2" \
      "$HF_SCRIPT_URL"
    echo ""
    echo "Monitor: hf jobs ps --all"
    echo "Status:  hf jobs inspect <job-id>"
    echo "Logs:    hf jobs logs <job-id>          # snapshot"
    echo "         hf jobs logs -f <job-id>        # stream (hf >= 1.28; old CLI: omit -f)"
    echo "Wait:    hf jobs wait <job-id>"
    echo "Pull:    hf download ${HF_HUB_MODEL} --local-dir workers/facts-worker/checkpoints/nli-mnli-probe-l40"
    ;;
  *)
    echo "Usage: $0 [upload|submit]"
    echo ""
    echo "  upload  — push train_mnli_probe_l40.py to HF_SCRIPT_REPO (one-time)"
    echo "  submit  — launch L40 Jobs run (default)"
    exit 1
    ;;
esac
