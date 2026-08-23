# Liquid AI Track A — LFM2.5-Encoder NLI evaluation

**Status:** Complete (2026-08-20) · **Verdict:** Go on **230M v3** for opt-in production trials.

Start with the wrap-up: [LIQUIDAI-NLI-EVAL-WRAPUP-2026-08-20.md](./LIQUIDAI-NLI-EVAL-WRAPUP-2026-08-20.md)

---

## Hugging Face (weights + data)

| Resource | Hub |
|----------|-----|
| Production checkpoint (230M v3) | [jeanbaptdzd/lfm25-nli-v3-calibrated-l4](https://huggingface.co/jeanbaptdzd/lfm25-nli-v3-calibrated-l4) |
| Domain corpus (1k pairs) | [jeanbaptdzd/liquid-nli-domain-1k](https://huggingface.co/datasets/jeanbaptdzd/liquid-nli-domain-1k) |
| Training scripts | [jeanbaptdzd/liquid-nli-scripts](https://huggingface.co/jeanbaptdzd/liquid-nli-scripts) |
| 350M L4 retune | [jeanbaptdzd/lfm25-nli-350m-v1k-mps-recipe-l4](https://huggingface.co/jeanbaptdzd/lfm25-nli-350m-v1k-mps-recipe-l4) |

```bash
# Checkpoint for facts-worker
hf download jeanbaptdzd/lfm25-nli-v3-calibrated-l4 \
  --local-dir workers/facts-worker/checkpoints/nli-domain-v3-calibrated

# Training JSONL (not stored in git)
bash scripts/download-liquid-nli-dataset.sh
```

---

## Reproduce from seeds

```bash
# Rebuild dataset from YAML seeds (or use HF download above)
python model_evals/liquidai-encoders/build_domain_dataset.py

# Gold harness vs live worker
bash scripts/run-liquid-nli-gold-eval.sh workers/facts-worker/checkpoints/nli-domain-v3-calibrated

# Issue 06 smoke (paraphrase + contradiction)
bash scripts/run-liquid-nli-issue06-smoke.sh
```

---

## Layout

| Path | Purpose |
|------|---------|
| `dataset/seeds/` | Hand-labeled + mined YAML source of truth |
| `dataset/split_manifest.json` | Split metadata (regenerate with builder) |
| `hf_jobs/` | HF L4 training job scripts |
| `train_*.py`, `lfm2_nli_classifier.py` | Local / MPS training |
| `phase2g-refine-v3-gold-minconf077.json` | Production gold eval artifact |
| `baseline-deberta-v3-large-gold.json` | CrossEncoder baseline reference |

Intermediate phase reports were consolidated into the wrap-up; earlier artifacts remain in git history.

---

## Integration (opt-in)

```bash
SKIP_NLI=0
NLI_BACKEND=liquidai
LIQUID_NLI_MODE=finetuned
EQUIV_MIN_CONFIDENCE=0.77
```

See [.env.example](../../.env.example) and [workers/facts-worker/nli_liquid.py](../../workers/facts-worker/nli_liquid.py).
