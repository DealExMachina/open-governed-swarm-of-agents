#!/usr/bin/env bash
# Local MPS pipeline: fast SNLI probe (if missing) → domain Stage 2 → refine Stage 3 → eval
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENC="$ROOT/model_evals/liquidai-encoders"
VENV="$ENC/.venv"
PROBE_CKPT="$ROOT/workers/facts-worker/checkpoints/nli-mnli-probe"
DOMAIN_CKPT="$ROOT/workers/facts-worker/checkpoints/nli-domain-v1"
REFINE_CKPT="$ROOT/workers/facts-worker/checkpoints/nli-domain-v1-calibrated"

DEVICE="${LIQUID_DEVICE:-auto}"
PROBE_SAMPLES="${LIQUID_PROBE_SAMPLES:-2000}"
SKIP_PROBE="${SKIP_PROBE:-0}"

cd "$ENC"

if [[ ! -d "$VENV" ]]; then
  echo "Creating venv at $VENV …"
  python3 -m venv "$VENV"
  source "$VENV/bin/activate"
  pip install -q --upgrade pip
  pip install -q "torch>=2.2" "transformers>=4.44" "datasets>=2.14" "accelerate>=0.26" "pyyaml>=6" "scikit-learn>=1.3"
else
  source "$VENV/bin/activate"
fi

python -c "from nli_train_utils import resolve_device; print('Using device:', resolve_device('${DEVICE}'))"

if [[ "$SKIP_PROBE" != "1" ]] && [[ ! -f "$PROBE_CKPT/nli_config.json" ]]; then
  echo "== Stage 1 bootstrap probe (${PROBE_SAMPLES} SNLI samples) =="
  python train_mnli_probe.py \
    --max-samples "$PROBE_SAMPLES" \
    --epochs 1 \
    --batch-size 4 \
    --grad-accum 4 \
    --device "$DEVICE"
else
  echo "== Stage 1 probe skipped (checkpoint exists or SKIP_PROBE=1) =="
fi

echo "== Stage 2 domain adaptation =="
python train_domain_nli.py --stage domain --device "$DEVICE"

echo "== Stage 2 eval (domain eval.jsonl) =="
python eval_nli_checkpoint.py "$DOMAIN_CKPT" \
  --device "$DEVICE" \
  --out "$ENC/phase1b-domain-v1-eval-metrics.json"

echo "== Stage 3 hard-negative refine =="
python train_domain_nli.py --stage refine --init-checkpoint "$DOMAIN_CKPT" --device "$DEVICE"

echo "== Stage 3 eval =="
python eval_nli_checkpoint.py "$REFINE_CKPT" \
  --device "$DEVICE" \
  --out "$ENC/phase1b-refine-eval-metrics.json"

echo ""
echo "Checkpoints:"
echo "  probe:  $PROBE_CKPT"
echo "  domain: $DOMAIN_CKPT"
echo "  refine: $REFINE_CKPT"
echo ""
echo "Gold harness eval (restart facts-worker with LIQUID_NLI_MODE=finetuned):"
echo "  LIQUID_NLI_CHECKPOINT=$REFINE_CKPT docker compose …"
echo "  FACTS_WORKER_URL=http://127.0.0.1:8011 npx tsx scripts/eval-nli-gold-set.ts \\"
echo "    --out=$ENC/phase1b-refine-gold.json"
