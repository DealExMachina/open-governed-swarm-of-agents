# Liquid AI NLI — Phase 1 zero-shot (first shot)

Reproducible comparison of **LFM2.5-Encoder-230M** (zero-shot anchor probe) vs **DeBERTa v3 large** on the frozen SGRS NLI gold harness.

## Harness (shared)

| Item | Path |
|------|------|
| Gold fixture (57 pairs, frozen) | `test/fixtures/nli-gold-set.yaml` |
| Held-out (6 pairs) | `test/fixtures/nli-held-out.yaml` |
| Eval script | `scripts/eval-nli-gold-set.ts` |
| Pipeline | `nliEntailment → shouldProposeEquivalence → decideEquivalence` |
| minConfidence | 0.7 |

## Baseline (Phase 0) — DeBERTa v3 large

Already captured 2026-08-19:

- `baseline-deberta-v3-large-gold.json`
- `baseline-deberta-v3-large-held-out.json`
- `baseline-deberta-v3-large-manifest.json`
- `baseline-deberta-v3-large-report.md`

**Gold gates:** falseMergeRate **0.0%**, blockRecall **94.1%**

## Challenger (Phase 1A) — LFM zero-shot

**Method:** `NLI_BACKEND=liquidai`, `LIQUID_NLI_MODE=zero_shot`  
Encoder mean-pools pair text; cosine similarity vs three natural-language class anchors → pseudo-logits (same 3-way order as CrossEncoder).

**Not** MNLI fine-tune — that is Phase 1B (`train_mnli_probe.py`).

### Run

```bash
./scripts/run-liquid-zero-shot-eval.sh
```

Or manually:

```bash
# Worker on port 8011 (keeps DeBERTa baseline on 8010)
docker compose run -d --name asg-facts-liquid-nli --no-deps -p 8011:8010 \
  -e SKIP_NLI=0 -e NLI_BACKEND=liquidai -e LIQUID_NLI_MODE=zero_shot \
  -e LIQUID_NLI_MODEL=LiquidAI/LFM2.5-Encoder-230M \
  facts-worker sh -c "pip install -q -r requirements-full.txt && uvicorn app:app --host 0.0.0.0 --port 8010"

FACTS_WORKER_URL=http://127.0.0.1:8011 npx tsx scripts/eval-nli-gold-set.ts \
  --out=model_evals/liquidai-encoders/phase1-lfm-zero-shot-gold.json

npx tsx scripts/compare-nli-eval-reports.ts \
  model_evals/liquidai-encoders/baseline-deberta-v3-large-gold.json \
  model_evals/liquidai-encoders/phase1-lfm-zero-shot-gold.json \
  --out=model_evals/liquidai-encoders/phase1-zero-shot-vs-deberta.md
```

### Artifacts

| File | Purpose |
|------|---------|
| `phase1-lfm-zero-shot-gold.json` | Gold eval JSON |
| `phase1-lfm-zero-shot-held-out.json` | Held-out eval |
| `phase1-lfm-zero-shot-manifest.json` | Run metadata |
| `phase1-zero-shot-vs-deberta.md` | Side-by-side table |

## Next (Phase 1B)

See **[TRAINING-PLAN.md](./TRAINING-PLAN.md)** for the full head training curriculum.

Summary:
1. **Stage 1** — SNLI/MNLI probe (`train_mnli_probe.py`)
2. **Stage 2** — Domain pairs (Issue 01 dataset) + class-weighted CE
3. **Stage 3** — Hard-negative refine + `minConfidence` sweep if gates miss

Target: **falseMergeRate = 0%**, block recall ≥ 94% on frozen gold harness.
