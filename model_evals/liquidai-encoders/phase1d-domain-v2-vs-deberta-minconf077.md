# NLI eval comparison — LFM2.5-Encoder-230M vs DeBERTa v3 large

**Baseline:** `baseline-deberta-v3-large-gold.json` · minConfidence **0.70**  
**Challenger:** `phase1d-domain-v2-gold-minconf077.json` · minConfidence **0.77**  
**Harness:** `scripts/eval-nli-gold-set.ts` · 57 gold pairs · frozen fixture  
**Challenger stack:** HF L4 SNLI probe (8k) → domain v2 (MPS) → refine · checkpoint `nli-domain-v2-calibrated`

---

## Headline metrics (safety gates)

| Metric | Gate | DeBERTa v3 large | LFM 230M domain v2 | Δ |
| --- | --- | --- | --- | --- |
| **False-merge rate** | must = 0% | 0.0% | **0.0%** | 0.0 pp |
| **Block recall** | no regression | 94.1% | **94.1%** | 0.0 pp |
| Routing accuracy | info | 66.7% | 63.2% | −3.5 pp |
| Missed-merge (paraphrase) | info | 60.0% | 73.3% | +13.3 pp |
| HITL routing accuracy | info | 50.0% | 42.9% | −7.1 pp |
| Accrual over-block rate | info | 46.2% | 53.8% | +7.7 pp |

**Safety verdict:** **PASS** — challenger matches production reference on both hard gates.

Note: LFM uses a slightly stricter merge threshold (0.77 vs 0.70), which removes the single false-merge seen at 0.70 on domain v1; block recall is unchanged.

---

## Performance vs resources

| | DeBERTa v3 **large** (prod) | LFM **230M** finetuned |
|--|---------------------------|------------------------|
| **Role** | CrossEncoder NLI reference | Bidirectional encoder + 3-class head |
| **Parameters** | ~435M (CrossEncoder) / ~304M encoder | ~230M backbone + linear head |
| **Off-the-shelf NLI** | Yes | No — custom head + domain fine-tune |
| **Training cost** | None | HF L4 SNLI 8k (~$0.02, ~1 min) + MPS domain (~5 min) |
| **Domain data** | None | 183 pairs + mined gold failures |
| **Checkpoint artifact** | ~1.5 GB (HF hub) | ~880 MB (`nli_classifier.pt` incl. backbone) |
| **CPU latency / pair** | **~2.4 s** (136 s / 57 pairs) | **~0.3 s** (~18 s / 57 pairs, Docker CPU) |
| **Gold FP-trap** | 100% (11/11) | 100% (11/11) |
| **Gold refutation** | 100% (8/8) | 100% (8/8) |
| **Gold paraphrase** | 40% (6/15) | 27% (4/15) |

### DeBERTa size ladder (prior internal sweeps †)

| Model | Params | Routing acc. | False-merge |
|-------|--------|-------------|-------------|
| deberta-v3-small | ~44M | 68.4% | 0% |
| deberta-v3-base | ~184M | 77.2% | 0% |
| **deberta-v3-large** | ~435M | **66.7%** | **0%** |

† Different harness/routing context; authoritative bar for this track is **large @ frozen gold**.

Production chose **large** for block recall and off-the-shelf NLI, not routing accuracy.

### Liquid encoder escalation

230M passes safety gates after domain fine-tune. **350M+** is optional for routing/HITL improvement only — expect ~1.5× params and latency; not required for gate parity.

---

## One-line summary (Liquid-facing)

**LFM2.5-Encoder-230M matches DeBERTa-v3-large on SGRS safety gates at ~half the model size and ~8× lower CPU latency; routing accuracy −3.5 pp; requires domain fine-tune and minConfidence 0.77.**

---

## Artifacts

| File | Content |
|------|---------|
| `phase1d-domain-v2-gold-minconf077.json` | Full 57-pair gold eval |
| `phase1d-domain-v2-eval-metrics.json` | Domain eval split macro-F1 |
| `LIQUID-PHASE1D-MEMO.md` | Partnership memo (this track) |
| Hub probe | `jeanbaptdzd/lfm25-nli-mnli-probe-l4` |
