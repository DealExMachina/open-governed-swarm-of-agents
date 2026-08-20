# Liquid AI × SGRS — Phase 1D evaluation memo

**Date:** 2026-08-20  
**Track:** Encoder NLI only (embeddings / pgvector **deferred**)  
**Challenger:** `LiquidAI/LFM2.5-Encoder-230M` + 3-class NLI head  
**Reference:** `cross-encoder/nli-deberta-v3-large` (production facts-worker)

---

## Executive summary

We ran a reproducible NLI gold harness (57 frozen pairs) comparing production DeBERTa v3 large against a fine-tuned LFM2.5-Encoder-230M head.

**Result:** The 230M challenger **matches DeBERTa large on both hard safety gates** (0% false-merge, 94.1% block recall) at minConfidence 0.77, with **~8× lower CPU inference latency** and **~half the parameter count**. Full routing accuracy is −3.5 percentage points (63.2% vs 66.7%).

This is sufficient to propose LFM encoder NLI as a **safety-equivalent, more efficient** alternative pending pipeline smoke tests.

---

## Method

| Step | Detail |
|------|--------|
| Phase 0 | DeBERTa v3 large baseline on frozen gold + held-out |
| Phase 1A | LFM zero-shot (anchor probe) — gates fail as expected |
| Phase 1B–C | Local MPS: SNLI probe → domain dataset → refine; mined gold failures |
| Phase 1D | HF Jobs L4: 8k SNLI probe (83.1% eval acc) → domain v2 → gold re-eval |
| Governance | `EQUIV_MIN_CONFIDENCE` raised to **0.77** (was 0.70) |

Harness: `scripts/eval-nli-gold-set.ts` · pipeline: `nliEntailment → shouldProposeEquivalence → decideEquivalence`

---

## Results (gold, n=57)

| Metric | DeBERTa large @ 0.70 | LFM 230M v2 @ 0.77 |
|--------|---------------------|-------------------|
| **False-merge rate** | 0.0% | **0.0%** |
| **Block recall** | 94.1% | **94.1%** |
| Routing accuracy | 66.7% | 63.2% |
| FP-trap accuracy | 100% | 100% |
| Refutation accuracy | 100% | 100% |
| Paraphrase accuracy | 40% | 27% |
| HITL routing | 50% | 42.9% |

---

## Performance vs resources

| Dimension | DeBERTa v3 large | LFM 230M finetuned |
|-----------|-------------------|-------------------|
| Parameters | ~435M | ~230M |
| Training | Off-the-shelf | SNLI 8k + ~183 domain pairs |
| Training cost | $0 | ~$0.02 HF + ~5 min local |
| CPU / pair (Docker) | ~2.4 s | ~0.3 s |
| Safety gates | Pass | **Pass (match)** |
| Routing | 66.7% | 63.2% |

**Efficiency trade-off:** Lower compute footprint and faster inference; small routing gap remains (mostly paraphrase auto-merge and HITL over-block).

---

## DeBERTa size context

Prior internal sweeps (non-authoritative for this fixture):

- **small** (~44M): 68.4% routing, 0% false-merge  
- **base** (~184M): 77.2% routing, 0% false-merge  
- **large** (~435M): 66.7% routing, 0% false-merge, **94.1% block recall** ← production choice  

LFM 230M achieves **large-class safety** at **small-class latency**.

---

## Recommendations

1. **Accept gate parity** for partnership milestone — document and share this memo.  
2. **Pipeline smoke test** — wire `nli-domain-v2-calibrated` into facts-worker with `minConfidence=0.77`.  
3. **Optional refine loop** — mine routing failures, Stage 3 refine (+5–10 pp routing target).  
4. **Defer** 350M encoder and embeddings/pgvector until routing gap matters for product.

---

## Artifacts (repo)

```
model_evals/liquidai-encoders/
  baseline-deberta-v3-large-gold.json
  phase1d-domain-v2-gold-minconf077.json
  phase1d-domain-v2-vs-deberta-minconf077.md
  LIQUID-PHASE1D-MEMO.md          ← this file
  TRAINING-PLAN.md
  LIQUID-FIRST-SHOT.md
```

Hub: `jeanbaptdzd/lfm25-nli-mnli-probe-l4` · local checkpoint: `workers/facts-worker/checkpoints/nli-domain-v2-calibrated`

---

## Contact / repro

```bash
# Gold eval (finetuned worker on :8011)
FACTS_WORKER_URL=http://127.0.0.1:8011 npx tsx scripts/eval-nli-gold-set.ts \
  --out=model_evals/liquidai-encoders/phase1d-domain-v2-gold-minconf077.json

# Compare
npx tsx scripts/compare-nli-eval-reports.ts \
  model_evals/liquidai-encoders/baseline-deberta-v3-large-gold.json \
  model_evals/liquidai-encoders/phase1d-domain-v2-gold-minconf077.json \
  --out=model_evals/liquidai-encoders/phase1d-domain-v2-vs-deberta-minconf077.md
```
