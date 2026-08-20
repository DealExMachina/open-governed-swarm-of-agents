# NLI zero-shot — `LiquidAI/LFM2.5-Encoder-230M`

**Phase:** 1A (first shot — harness + zero-shot probe)  
**Date:** 2026-08-19  
**Worker:** `http://127.0.0.1:8011` (`NLI_BACKEND=liquidai`, `LIQUID_NLI_MODE=zero_shot`)  
**Baseline:** `cross-encoder/nli-deberta-v3-large` (Phase 0, same harness)  
**Harness:** `scripts/eval-nli-gold-set.ts` · minConfidence **0.7**

---

## What this run proves

1. **Harness is live** — frozen 57-pair gold set + 6 held-out pairs, same SGRS equivalence pipeline as production.
2. **Liquid backend integrated** — facts-worker `/nli` routes through `nli_liquid.py` with no MNLI checkpoint required.
3. **Baseline delta captured** — side-by-side metrics vs DeBERTa v3 large before domain fine-tune.

Zero-shot here means **base encoder + class-anchor similarity**, not a trained NLI head. Safety gates are **expected to fail** until Phase 1B fine-tune.

---

## Headline metrics (gold set, n=57)

| Metric | DeBERTa v3 large | LFM zero-shot | Δ | Gate |
|--------|------------------:|--------------:|--:|------|
| **False-merge rate** | **0.0%** | **14.3%** | +14.3 pp | Must = 0% |
| **Block recall** | **94.1%** | **17.6%** | −76.5 pp | No regression |
| Routing accuracy | 66.7% | 42.1% | −24.6 pp | Info |
| Missed-merge (paraphrase) | 60.0% | 100.0% | +40.0 pp | Info |

**Safety verdict:** **FAIL** (not production-ready; documents starting point).

---

## By category (gold, zero-shot)

| Category | Accuracy | Notes |
|----------|----------|-------|
| refutation | **100%** (8/8) | Anchor probe picks up explicit refutation language |
| false_positive_trap | **82%** (9/11) | Two S4 traps false-merged |
| ambiguous_hitl | 50% (7/14) | Same as baseline |
| paraphrase | **0%** (0/15) | No paraphrase auto-merges — bidirectional entailment never clears threshold |
| contradiction | **0%** (0/9) | Misses most block signals |

---

## Held-out (n=6)

| Metric | DeBERTa | LFM zero-shot |
|--------|--------:|--------------:|
| False-merge rate | 0.0% | 0.0% |
| Block recall | 100% | 50.0% |
| Accuracy | 50.0% | 50.0% |

---

## Latency (CPU, Docker)

| | DeBERTa | LFM zero-shot |
|--|--------:|----------------:|
| 57 gold pairs | ~136 s | **~17 s** |
| Mean per pair | ~2.4 s | **~0.3 s** |

LFM zero-shot is faster per pair but **not safe** for equivalence routing at current thresholds.

---

## Artifacts

| File | Purpose |
|------|---------|
| `phase1-lfm-zero-shot-gold.json` | Full gold eval |
| `phase1-lfm-zero-shot-held-out.json` | Held-out eval |
| `phase1-zero-shot-vs-deberta.md` | Comparison table |
| `phase1-lfm-zero-shot-manifest.json` | Run metadata |

---

## Reproduce

```bash
./scripts/run-liquid-zero-shot-eval.sh
```

See `phase1-readme.md` for manual steps.

---

## Next step (Phase 1B)

Fine-tune 3-class NLI head on MNLI probe (`train_mnli_probe.py`), set `LIQUID_NLI_MODE=finetuned`, re-run same harness. Target: **falseMergeRate = 0%**, block recall ≥ 94%.
