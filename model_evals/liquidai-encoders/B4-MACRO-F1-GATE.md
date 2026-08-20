# Issue 05 — B4 macro-F1 gate (domain eval.jsonl, n=49)

**Date:** 2026-08-20  
**Split:** `dataset/eval.jsonl` (frozen, seed 42)  
**Direction:** single premise→hypothesis (matches `eval_nli_checkpoint.py`)

## Baseline — DeBERTa v3 large

| Metric | Value |
|--------|------:|
| **macro-F1** | **0.722** |
| accuracy | 0.714 |
| f1_contradiction | 0.714 |
| f1_entailment | 0.769 |
| f1_neutral | 0.682 |

Artifact: `baseline-deberta-v3-large-eval-metrics.json`

## Challenger — LFM2.5-Encoder-230M (checkpoints)

| Checkpoint | macro-F1 | Δ vs DeBERTa |
|------------|----------|--------------|
| domain v2 | 0.606 | −0.116 |
| refine v2 | 0.617 | −0.105 |
| wd=0.1 refine | 0.505 | −0.217 |

Tolerance (manifest): baseline − **0.02** → threshold **0.702**

## B4 verdict

**FAIL on macro-F1 parity** — no 230M checkpoint reaches DeBERTa eval-split macro-F1 within tolerance.

**Note:** Gold harness safety gates (false-merge = 0%, block recall = 94.1%) can still pass while B4 fails. B4 measures labeled domain eval split fit; gold measures production routing under mutual entailment + minConfidence.

## Next

- **350M track** — `scripts/run-liquid-nli-350m-mps.sh` (Liquid wd=0.1 recipe)
- Re-score gold at matched minConf for routing comparisons
