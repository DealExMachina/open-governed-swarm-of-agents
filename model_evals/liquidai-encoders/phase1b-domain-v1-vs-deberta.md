# NLI eval comparison

**Baseline:** `model_evals/liquidai-encoders/baseline-deberta-v3-large-gold.json`  
**Challenger:** `model_evals/liquidai-encoders/phase1b-domain-v1-gold.json`  
**Harness:** `scripts/eval-nli-gold-set.ts` · 57 gold pairs · minConfidence 0.7

| Metric | Gate | DeBERTa v3 large | model_evals/liquidai-encoders/phase1b-domain-v1-gold.json | Δ |
| --- | --- | --- | --- | --- |
| False-merge rate | must = 0% | 0.0% | 2.4% | +2.4 pp |
| Block recall | no regression | 94.1% | 64.7% | -29.4 pp |
| Routing accuracy | info | 66.7% | 57.9% | -8.8 pp |
| Missed-merge (paraphrase) | info | 60.0% | 80.0% | +20.0 pp |
| HITL routing accuracy | info | 50.0% | 50.0% | 0.0 pp |
| Accrual over-block rate | info | 46.2% | 46.2% | 0.0 pp |

## Interpretation

- **False-merge rate = 0%** is the hard safety gate for SGRS equivalence.
- Zero-shot LFM encoder probe is expected to underperform DeBERTa on routing accuracy; the point is a **reproducible harness** and baseline delta before domain fine-tune.
