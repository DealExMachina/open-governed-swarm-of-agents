# NLI model evaluation (LiquidAI LFM2.5-Encoder)

Smoke harness for scoring NLI backends against the **frozen** gold set at [`test/fixtures/nli-gold-set.yaml`](../../test/fixtures/nli-gold-set.yaml) (57 pairs). The gold set is **evaluation-only** — never used for training.

Governance routing is scored via the production pipeline in [`src/baselines/scenario/nli-eval.ts`](../../src/baselines/scenario/nli-eval.ts) (`falseMergeRate`, `blockRecall`, `accrualOverBlockRate`, etc.).

## Quick start

```bash
# 1. Python venv (once)
cd workers/facts-worker && python3 -m venv .venv && source .venv/bin/activate
pip install torch transformers sentence-transformers pyyaml datasets pytest fastapi uvicorn pydantic python-dotenv

# 2. Generate verdicts (from repo root, venv active)
python workers/facts-worker/tools/nli_verdicts.py --backend=deberta
python workers/facts-worker/tools/nli_verdicts.py --backend=lfm-cosine --model=LiquidAI/LFM2.5-Encoder-230M
python workers/facts-worker/tools/nli_verdicts.py --backend=lfm-head --checkpoint=model_evals/nli/lfm-head-230m

# 3. Score through SGRS governance routing
pnpm run nli:smoke -- --verdicts=model_evals/nli/verdicts-deberta.json
pnpm run nli:smoke -- --verdicts=model_evals/nli/verdicts-lfm-cosine.json --compare=model_evals/nli/verdicts-deberta.json
pnpm run nli:smoke -- --verdicts=model_evals/nli/verdicts-lfm-head.json --compare=model_evals/nli/verdicts-deberta.json
```

Requires `HF_TOKEN` in `.env` for LiquidAI encoder downloads.

## Backends

| Backend | Model | Role |
|---------|-------|------|
| `deberta` | `cross-encoder/nli-deberta-v3-base` | Production baseline (`NLI_MODEL`) |
| `lfm-cosine` | `LiquidAI/LFM2.5-Encoder-230M` (or `-350M`) | Zero-shot mean-pooled cosine similarity — **cannot** emit `contradiction` |
| `lfm-head` | Fine-tuned checkpoint from `train_nli_head.py` | 3-class cross-encoder head on LFM2.5-Encoder |

**Important:** LFM2.5-Encoder checkpoints are base masked-LM models. Use `AutoModelForMaskedLM` (not `AutoModel`) when loading — see [`workers/facts-worker/tools/nli_verdicts.py`](../../workers/facts-worker/tools/nli_verdicts.py).

## Fine-tune DeBERTa cross-encoder (recommended)

Continue training from `cross-encoder/nli-deberta-v3-base` on a mixed NLI corpus
(MNLI + ANLI + WANLI + FEVER-NLI + MNLI paraphrase bank). Gold set remains eval-only.

```bash
source workers/facts-worker/.venv/bin/activate
pip install datasets  # if missing

# Smoke (10k pairs, ~45–90 min on Mac 16GB)
pnpm run nli:train -- \
  --output-dir model_evals/nli/deberta-ft-10k \
  --max-samples 10000 --epochs 1 --batch-size 8

# Score fine-tuned checkpoint
python workers/facts-worker/tools/nli_verdicts.py \
  --backend=deberta --model=model_evals/nli/deberta-ft-10k \
  --out=model_evals/nli/verdicts-deberta-ft-10k.json
pnpm run nli:smoke -- \
  --verdicts=model_evals/nli/verdicts-deberta-ft-10k.json \
  --compare=model_evals/nli/verdicts-deberta.json

# Full mix (~750k+) — use HF Jobs A10G (~2–3 h) or local overnight
pnpm run nli:train -- --full --output-dir model_evals/nli/deberta-ft-full \
  --epochs 1 --batch-size 16
```

HF Jobs wrapper: `workers/facts-worker/training/hf_jobs_deberta_nli.py` (PEP 723 uv script).

## Fine-tune LFM NLI head (Liquid encoder experiments)

```bash
source workers/facts-worker/.venv/bin/activate
python workers/facts-worker/training/train_nli_head.py \
  --base-model LiquidAI/LFM2.5-Encoder-230M \
  --output-dir model_evals/nli/lfm-head-230m \
  --max-train-samples 4000 --epochs 3
```

Training data: MNLI via `nyu-mll/glue` (never the gold set). For a full run, omit `--max-train-samples`.

## Phase 0 results (local run, Aug 2026)

Metrics at `minConfidence=0.7` on the held-out 57 pairs:

| Backend | Accuracy | falseMergeRate | blockRecall | accrualOverBlock | Latency p50 (ms) |
|---------|----------|----------------|-------------|------------------|------------------|
| deberta-base (baseline) | **68.4%** | **0.0%** | **100.0%** | 53.8% | 33 |
| deberta-small (previous) | 63.2% | **0.0%** | 94.1% | 53.8% | 21 |
| lfm-cosine | 59.6% | 4.8% | 0.0% | **0.0%** | 837 |
| lfm-head (500-sample smoke train) | 57.9% | **0.0%** | 0.0% | **0.0%** | 756 |

### Interpretation

- **lfm-cosine** confirms that similarity-without-inference cannot replace NLI: `blockRecall=0%`, one false merge on `generic-fp-same-subject-01`. Expected — motivates fine-tuning.
- **DeBERTa-base baseline** (production default) meets the critical safety bar (`falseMergeRate=0%`) with full `blockRecall` (100%) on finance-domain pairs. Paraphrase auto-merge improved vs small (47% vs 27%) but remains the main gap.
- **lfm-head (minimal train)** — 500 MNLI samples, 1 epoch, 36.5% MNLI val accuracy — is **not** production-ready (`blockRecall=0%`). A full MNLI fine-tune (230M then 350M) is required before comparing against DeBERTa on acceptance criteria.

JSON reports: `model_evals/nli/report-{deberta,lfm-cosine,lfm-head}.json`.

## Acceptance criteria (vs DeBERTa)

Before swapping `NLI_MODEL` in the facts-worker:

1. `falseMergeRate` no worse than baseline (governance-critical)
2. `blockRecall` at least baseline on `contradiction` + `refutation`
3. `accrualOverBlockRate` at least as low as baseline
4. CPU latency per pair at or below baseline (LFMs target edge deployment)
5. Confidence sweep 0.5–0.9 documented for `EQUIV_MIN_CONFIDENCE` retuning

## Worker integration

[`workers/facts-worker/rlm_facts.py`](../../workers/facts-worker/rlm_facts.py) updates:

- `CrossEncoder(..., trust_remote_code=True)` for custom HF NLI checkpoints
- `_row_to_probs()` reads `config.id2label` instead of assuming DeBERTa label order
- `NLI_ENTAILMENT_MODE=onesided_safe` relaxes mutual entailment when max(contradiction) < `NLI_ONESIDED_MAX_CONTRADICTION` (default 0.3) and either min(other-direction entailment) >= `NLI_ONESIDED_MIN_OTHER` (0.03) or max(entailment) >= `NLI_ONESIDED_HIGH_CONF` (0.992). Default remains `mutual`. Gold-set with onesided_safe: 80.7% accuracy, 0% falseMerge, 13.3% missedMerge (vs 78.9% / 0% / 20% mutual).

Live worker eval (optional):

```bash
SKIP_NLI=0 NLI_MODEL=cross-encoder/nli-deberta-v3-base \
  FACTS_WORKER_URL=http://127.0.0.1:8010 \
  npx tsx scripts/ops/report-pipeline-metrics.ts --live
```

## Files

| Path | Purpose |
|------|---------|
| `workers/facts-worker/tools/nli_verdicts.py` | Offline verdict generator |
| `workers/facts-worker/training/train_deberta_nli.py` | DeBERTa cross-encoder continued fine-tune |
| `workers/facts-worker/training/hf_jobs_deberta_nli.py` | HF Jobs full-mix entrypoint |
| `workers/facts-worker/training/train_nli_head.py` | LFM encoder MNLI head fine-tune |
| `scripts/checks/nli-model-smoke.ts` | Gold-set governance scorer |
| `model_evals/nli/verdicts-*.json` | Generated verdicts |
| `model_evals/nli/report-*.json` | Scored reports + confidence sweep |

Trained weights (`pytorch_model.bin`) are gitignored; reproduce via `train_nli_head.py`.

## Licensing

LiquidAI models use [LFM Open License v1.0](https://www.liquid.ai/lfm-open-license). Confirm compatibility with this repo's split license (AGPL/ELv2/MIT) before production adoption.
