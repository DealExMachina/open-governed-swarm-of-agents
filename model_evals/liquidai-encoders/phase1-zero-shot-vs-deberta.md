# NLI eval comparison

**Baseline:** `model_evals/liquidai-encoders/baseline-deberta-v3-large-gold.json`  
**Challenger:** `model_evals/liquidai-encoders/phase1-lfm-zero-shot-gold.json`  
**Harness:** `scripts/eval-nli-gold-set.ts` · 57 gold pairs · minConfidence 0.7

| Metric | Gate | DeBERTa v3 large | LFM2.5-Encoder-230M (zero-shot) | Δ |
| --- | --- | --- | --- | --- |
| False-merge rate | must = 0% | 0.0% | 14.3% | +14.3 pp |
| Block recall | no regression | 94.1% | 17.6% | -76.5 pp |
| Routing accuracy | info | 66.7% | 42.1% | -24.6 pp |
| Missed-merge (paraphrase) | info | 60.0% | 100.0% | +40.0 pp |
| HITL routing accuracy | info | 50.0% | 50.0% | 0.0 pp |
| Accrual over-block rate | info | 46.2% | 30.8% | -15.4 pp |

## Interpretation

- **False-merge rate = 0%** is the hard safety gate for SGRS equivalence.
- Zero-shot LFM encoder probe is expected to underperform DeBERTa on routing accuracy; the point is a **reproducible harness** and baseline delta before domain fine-tune.
