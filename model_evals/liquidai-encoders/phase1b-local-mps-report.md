# Phase 1B — local MPS training run

**Date:** 2026-08-20  
**Device:** Apple MPS (16 GB), batch 4 × grad_accum 4  
**Pipeline:** `./scripts/run-liquid-nli-local-mps.sh`

---

## Wall-clock (this machine)

| Stage | Duration | Notes |
|-------|----------|-------|
| venv setup (first run) | ~2 min | `model_evals/liquidai-encoders/.venv` |
| **1 — SNLI probe** (1500 samples) | **~2 min** | `nli-mnli-probe` |
| **2 — Domain** (186 ex, 3 epochs) | **~48 s** | `nli-domain-v1` |
| **3 — Refine** (77 ex, 1 epoch) | **~7 s** | `nli-domain-v1-calibrated` |
| Gold harness eval (CPU Docker) | ~18 s | 57 pairs |
| **Total train + eval** | **~5 min** | Excluding first pip/model download |

---

## Domain eval split (macro-F1)

| Checkpoint | macro-F1 | accuracy |
|------------|----------|----------|
| `nli-domain-v1` | 0.356 | 0.367 |
| `nli-domain-v1-calibrated` | 0.340 | 0.388 |

---

## Gold harness vs DeBERTa (57 pairs)

| Metric | DeBERTa v3 large | Zero-shot | **Domain v1** |
|--------|------------------:|----------:|--------------:|
| False-merge rate | **0.0%** | 14.3% | **2.4%** |
| Block recall | **94.1%** | 17.6% | **64.7%** |
| Routing accuracy | 66.7% | 42.1% | **57.9%** |

**Verdict:** Large improvement over zero-shot; **still fails** safety gates (false-merge > 0, block recall < 94%).

Artifacts:
- `phase1b-domain-v1-gold.json`
- `phase1b-domain-v1-vs-deberta.md`
- `phase1b-domain-v1-eval-metrics.json`
- `phase1b-refine-eval-metrics.json`

---

## Checkpoints

```
workers/facts-worker/checkpoints/
  nli-mnli-probe/              # Stage 1 bootstrap (1500 SNLI)
  nli-domain-v1/               # Stage 2 — use for gold eval
  nli-domain-v1-calibrated/    # Stage 3 refine
```

Custom format: `nli_classifier.pt` + `nli_config.json` (see `lfm2_nli_classifier.py`).

---

## Reproduce

```bash
cd agents-swarm-governed

# Full pipeline (probe skipped if checkpoint exists)
./scripts/run-liquid-nli-local-mps.sh

# Stage 2–3 only
cd model_evals/liquidai-encoders && source .venv/bin/activate
SKIP_PROBE=1 bash ../../scripts/run-liquid-nli-local-mps.sh

# Gold eval via facts-worker
docker compose run -d --name asg-facts-liquid-nli --no-deps -p 8011:8010 \
  -e SKIP_NLI=0 -e NLI_BACKEND=liquidai -e LIQUID_NLI_MODE=finetuned \
  -e LIQUID_NLI_CHECKPOINT=/app/checkpoints/nli-domain-v1 facts-worker \
  sh -c "pip install -q -r requirements-full.txt && uvicorn app:app --host 0.0.0.0 --port 8010"

FACTS_WORKER_URL=http://127.0.0.1:8011 npx tsx scripts/eval-nli-gold-set.ts \
  --out=model_evals/liquidai-encoders/phase1b-domain-v1-gold.json
```

---

## Next hyperparam iterations (local MPS)

1. **More probe data** — `--max-samples 8000` on Stage 1 (HF L40S or ~10 min MPS)
2. **Lower LR / more domain epochs** — `--epochs 5 --lr 5e-6`
3. **Hard-negative mining** — add gold failures to `dataset/seeds/` and rebuild
4. **minConfidence sweep** — 0.75–0.85 may clear false-merge without retrain
5. **Stage 1 on L40S** — domain Stages 2–3 stay local (~1 min)
