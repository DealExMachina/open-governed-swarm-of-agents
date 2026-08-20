#!/usr/bin/env bash
# LFM2.5-Encoder-230M — Liquid encoder_eval recipe (Stage 1 MNLI + Stage 2 domain + Stage 3 refine)
#
# Aligns with Liquid model card / encoder_eval:
#   wd=0.1 + warmup=0.1 + adam_beta2=0.95 on Stage 2 domain (full tri-class)
#   wd=0.01 on Stage 3 refine (contradiction+neutral only — do NOT use wd=0.1 here)
#
# Requires expanded domain corpus (≥1000 pairs). Regenerate first:
#   python model_evals/liquidai-encoders/generate_synthetic_domain_pairs.py
#   python model_evals/liquidai-encoders/build_domain_dataset.py --min-total 1000 --min-per-label 330 --min-multilingual 400
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENC="$ROOT/model_evals/liquidai-encoders"
VENV="$ENC/.venv"
MODEL_ID="LiquidAI/LFM2.5-Encoder-230M"
PROBE_CKPT="$ROOT/workers/facts-worker/checkpoints/nli-mnli-probe-v3"
DOMAIN_CKPT="$ROOT/workers/facts-worker/checkpoints/nli-domain-v3-liquid"
REFINE_CKPT="$ROOT/workers/facts-worker/checkpoints/nli-domain-v3-calibrated"

DEVICE="${LIQUID_DEVICE:-auto}"
PROBE_SAMPLES="${LIQUID_PROBE_SAMPLES:-15000}"
PROBE_DATASET="${LIQUID_PROBE_DATASET:-mnli}"
SKIP_PROBE="${SKIP_PROBE:-0}"
DOMAIN_WD="${LIQUID_DOMAIN_WD:-0.1}"
REFINE_WD="${LIQUID_REFINE_WD:-0.01}"
ADAM_BETA2="${LIQUID_ADAM_BETA2:-0.95}"

cd "$ENC"
if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV"
  source "$VENV/bin/activate"
  pip install -q --upgrade pip
  pip install -q "torch>=2.2" "transformers>=4.44" "datasets>=2.14" "accelerate>=0.26" "pyyaml>=6" "scikit-learn>=1.3"
else
  source "$VENV/bin/activate"
fi

python -c "from nli_train_utils import resolve_device; print('Using device:', resolve_device('${DEVICE}'))"

if [[ "$SKIP_PROBE" != "1" ]] && [[ ! -f "$PROBE_CKPT/nli_config.json" ]]; then
  echo "== Stage 1: ${PROBE_DATASET} probe (${PROBE_SAMPLES} samples, beta2=${ADAM_BETA2}) =="
  python train_mnli_probe.py \
    --model-id "$MODEL_ID" \
    --dataset "$PROBE_DATASET" \
    --max-samples "$PROBE_SAMPLES" \
    --epochs 2 \
    --batch-size 4 \
    --grad-accum 4 \
    --lr 2e-5 \
    --weight-decay 0.1 \
    --warmup-ratio 0.1 \
    --adam-beta2 "$ADAM_BETA2" \
    --device "$DEVICE" \
    --out "$PROBE_CKPT"
else
  echo "== Stage 1 probe skipped (checkpoint exists or SKIP_PROBE=1) =="
fi

echo "== Stage 2: domain adaptation (wd=${DOMAIN_WD}, warmup=0.1, beta2=${ADAM_BETA2}) =="
python train_domain_nli.py \
  --stage domain \
  --model-id "$MODEL_ID" \
  --init-checkpoint "$PROBE_CKPT" \
  --out "$DOMAIN_CKPT" \
  --weight-decay "$DOMAIN_WD" \
  --warmup-ratio 0.1 \
  --adam-beta2 "$ADAM_BETA2" \
  --epochs 3 \
  --lr 2e-5 \
  --snli-mix 0.15 \
  --snli-cap 2000 \
  --batch-size 4 \
  --grad-accum 4 \
  --device "$DEVICE"

python eval_nli_checkpoint.py "$DOMAIN_CKPT" \
  --device "$DEVICE" \
  --out "$ENC/phase2g-domain-v3-liquid-eval-metrics.json"

echo "== Stage 3: hard-negative refine (wd=${REFINE_WD}, NOT Liquid wd on refine) =="
python train_domain_nli.py \
  --stage refine \
  --model-id "$MODEL_ID" \
  --init-checkpoint "$DOMAIN_CKPT" \
  --out "$REFINE_CKPT" \
  --weight-decay "$REFINE_WD" \
  --warmup-ratio 0 \
  --adam-beta2 0.999 \
  --epochs 1 \
  --lr 5e-6 \
  --batch-size 4 \
  --grad-accum 4 \
  --device "$DEVICE"

python eval_nli_checkpoint.py "$REFINE_CKPT" \
  --device "$DEVICE" \
  --out "$ENC/phase2g-refine-v3-eval-metrics.json"

echo ""
echo "230M Liquid-recipe checkpoints (v3, expanded corpus):"
echo "  probe:  $PROBE_CKPT"
echo "  domain: $DOMAIN_CKPT"
echo "  refine: $REFINE_CKPT"
echo ""
echo "Gold harness (fixed wait + preflight):"
echo "  bash scripts/run-liquid-nli-gold-eval.sh \\"
echo "    workers/facts-worker/checkpoints/nli-domain-v3-calibrated \\"
echo "    model_evals/liquidai-encoders/phase2g-refine-v3-gold-minconf077.json"
echo ""
echo "DeBERTa B4 baseline on new eval split:"
echo "  python model_evals/liquidai-encoders/eval_deberta_baseline.py"
