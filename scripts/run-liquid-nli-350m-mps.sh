#!/usr/bin/env bash
# LFM2.5-Encoder-350M NLI pipeline (MPS): SNLI probe → domain → refine → eval.jsonl
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENC="$ROOT/model_evals/liquidai-encoders"
VENV="$ENC/.venv"
MODEL_ID="LiquidAI/LFM2.5-Encoder-350M"
PROBE_CKPT="$ROOT/workers/facts-worker/checkpoints/nli-mnli-probe-350m"
DOMAIN_CKPT="$ROOT/workers/facts-worker/checkpoints/nli-domain-350m-v1"
REFINE_CKPT="$ROOT/workers/facts-worker/checkpoints/nli-domain-350m-v1-calibrated"

DEVICE="${LIQUID_DEVICE:-auto}"
PROBE_SAMPLES="${LIQUID_PROBE_SAMPLES:-4000}"
SKIP_PROBE="${SKIP_PROBE:-0}"
WEIGHT_DECAY="${LIQUID_WEIGHT_DECAY:-0.1}"

cd "$ENC"
source "$VENV/bin/activate"

python -c "from nli_train_utils import resolve_device; print('Using device:', resolve_device('${DEVICE}'))"

if [[ "$SKIP_PROBE" != "1" ]] && [[ ! -f "$PROBE_CKPT/nli_config.json" ]]; then
  echo "== Stage 1: SNLI probe (${PROBE_SAMPLES} samples, ${MODEL_ID}) =="
  python train_mnli_probe.py \
    --model-id "$MODEL_ID" \
    --max-samples "$PROBE_SAMPLES" \
    --epochs 1 \
    --batch-size 2 \
    --grad-accum 8 \
    --device "$DEVICE" \
    --out "$PROBE_CKPT"
else
  echo "== Stage 1 probe skipped =="
fi

echo "== Stage 2: domain adaptation (wd=${WEIGHT_DECAY}) =="
python train_domain_nli.py \
  --stage domain \
  --model-id "$MODEL_ID" \
  --init-checkpoint "$PROBE_CKPT" \
  --out "$DOMAIN_CKPT" \
  --weight-decay "$WEIGHT_DECAY" \
  --warmup-ratio 0.1 \
  --batch-size 2 \
  --grad-accum 8 \
  --device "$DEVICE"

python eval_nli_checkpoint.py "$DOMAIN_CKPT" \
  --device "$DEVICE" \
  --out "$ENC/phase350m-domain-v1-eval-metrics.json"

echo "== Stage 3: hard-negative refine =="
python train_domain_nli.py \
  --stage refine \
  --model-id "$MODEL_ID" \
  --init-checkpoint "$DOMAIN_CKPT" \
  --out "$REFINE_CKPT" \
  --weight-decay "$WEIGHT_DECAY" \
  --warmup-ratio 0 \
  --batch-size 2 \
  --grad-accum 8 \
  --device "$DEVICE"

python eval_nli_checkpoint.py "$REFINE_CKPT" \
  --device "$DEVICE" \
  --out "$ENC/phase350m-refine-eval-metrics.json"

echo ""
echo "350M checkpoints:"
echo "  probe:  $PROBE_CKPT"
echo "  domain: $DOMAIN_CKPT"
echo "  refine: $REFINE_CKPT"
echo ""
echo "Gold harness:"
echo "  LIQUID_NLI_CHECKPOINT=$REFINE_CKPT FACTS_WORKER_URL=http://127.0.0.1:8013 \\"
echo "    npx tsx scripts/eval-nli-gold-set.ts --out=$ENC/phase350m-refine-gold-minconf077.json"
