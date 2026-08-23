#!/usr/bin/env bash
# Download domain NLI corpus JSONL from Hugging Face into model_evals/liquidai-encoders/dataset/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/model_evals/liquidai-encoders/dataset"
REPO="${HF_DATA_REPO:-jeanbaptdzd/liquid-nli-domain-1k}"

mkdir -p "$OUT"

if ! command -v hf >/dev/null 2>&1; then
  echo "Install huggingface-cli: pip install huggingface_hub" >&2
  exit 1
fi

for file in train.jsonl eval.jsonl pairs.jsonl; do
  hf download "$REPO" "$file" --repo-type dataset --local-dir "$OUT"
done

echo "Dataset files in $OUT"
echo "Hub: https://huggingface.co/datasets/${REPO}"
