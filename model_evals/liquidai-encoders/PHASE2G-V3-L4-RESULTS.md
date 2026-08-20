# Phase 2G — LFM v3 Liquid recipe (HF L4, expanded corpus)

**Date:** 2026-08-20  
**Checkpoint:** `jeanbaptdzd/lfm25-nli-v3-calibrated-l4` → local `nli-domain-v3-calibrated`  
**Training:** HF Job `6a872e40c81709766c802b83` (COMPLETED, ~5 min L4)  
**Corpus:** 1006 pairs (711 train / 295 eval), Liquid recipe (MNLI 15k → domain wd=0.1 → refine wd=0.01)

---

## Gold harness (n=57, minConf 0.77)

| Metric | DeBERTa @ 0.77 | phase1e (230M) | **v3 L4** |
|--------|---------------:|---------------:|----------:|
| Routing accuracy | 66.7% | 66.7% | **82.5%** |
| False-merge rate | 0.0% | 0.0% | **0.0%** |
| Block recall | 94.1% | 94.1% | **94.1%** |
| HITL routing | 50.0% | 71.4% | **85.7%** |
| Paraphrase accuracy | — | 53.3% | **66.7%** |

Artifact: `phase2g-refine-v3-gold-minconf077.json`

**Safety gates: PASS** (0% false-merge, 94.1% block recall)

**Note:** 10 routing failures remain; several are `equivalent@1.00` but `resolved=no_merge` (bidirectional mutual-entailment gate, not single-direction NLI).

---

## B4 macro-F1 (eval.jsonl, n=295)

| Model | macro-F1 | B4 gate (≥ 0.710) |
|-------|----------:|-------------------|
| DeBERTa v3 large | **0.730** | PASS (baseline) |
| LFM v3 (HF job eval) | 0.959 | PASS |
| LFM v3 (local re-score) | see `phase2g-refine-v3-eval-metrics.json` | — |

DeBERTa baseline on expanded split: `baseline-deberta-v3-eval-split-metrics.json`

---

## Infrastructure fixes

- **HF job #1** failed: dataset upload missing `--repo-type dataset` (404 on train.jsonl).
- **Gold eval Docker** hung on silent `pip install` in `python:3.11-slim`; use **`LIQUID_GOLD_EVAL_LOCAL=1`** for fast local eval via existing `.venv`.
- **Successful HF job:** [`6a872e40c81709766c802b83`](https://huggingface.co/jobs/jeanbaptdzd/6a872e40c81709766c802b83)

---

## Recommendation

**v3 L4 supersedes phase1e** on gold routing (+15.8 pp) while holding safety gates. **Wired** into facts-worker (Issue 06): finetuned checkpoint `nli-domain-v3-calibrated` is the default when `NLI_BACKEND=liquidai` + `LIQUID_NLI_MODE=finetuned`.

Issue 06 smoke + B5 HITL replay:

```bash
bash scripts/run-liquid-nli-b5-hitl-replay.sh
```

Gold eval (local):

```bash
LIQUID_GOLD_EVAL_LOCAL=1 bash scripts/run-liquid-nli-gold-eval.sh \
  workers/facts-worker/checkpoints/nli-domain-v3-calibrated \
  model_evals/liquidai-encoders/phase2g-refine-v3-gold-minconf077.json
```
