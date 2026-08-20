# Liquid AI × SGRS — first evaluation shot

**Purpose:** Show Liquid we have a reproducible NLI harness and a first zero-shot run of **LFM2.5-Encoder-230M** against our production reference **DeBERTa v3 large**.

**Repo:** `agents-swarm-governed` · `model_evals/liquidai-encoders/`

---

## 1. Harness (ready)

| Component | Detail |
|-----------|--------|
| Gold fixture | 57 frozen safety pairs (`test/fixtures/nli-gold-set.yaml`) |
| Held-out | 6 pairs (`test/fixtures/nli-held-out.yaml`) |
| Eval script | `scripts/eval-nli-gold-set.ts` |
| Pipeline | Typed canonicalisation → **NLI** → governance routing |
| Safety gates | `falseMergeRate = 0%`, `blockRecall` no regression |

Embeddings / pgvector migration: **deferred** (out of scope for Track A).

---

## 2. Baseline — DeBERTa v3 large (Phase 0)

| Metric | Gold (n=57) |
|--------|------------:|
| False-merge rate | **0.0%** ✓ |
| Block recall | **94.1%** |
| Routing accuracy | 66.7% |

Report: `baseline-deberta-v3-large-report.md`

---

## 3. Zero-shot — LFM2.5-Encoder-230M (Phase 1A)

**Method:** Base encoder, mean-pooled pair embedding, cosine similarity vs three natural-language class anchors. No MNLI fine-tune.

| Metric | Gold (n=57) | vs DeBERTa |
|--------|------------:|-----------:|
| False-merge rate | **14.3%** | +14.3 pp ✗ |
| Block recall | **17.6%** | −76.5 pp ✗ |
| Routing accuracy | 42.1% | −24.6 pp |
| Latency / pair (CPU) | ~0.3 s | ~8× faster |

Report: `phase1-lfm-zero-shot-report.md`  
Comparison: `phase1-zero-shot-vs-deberta.md`

**Takeaway for Liquid:** Integration and harness are validated. Zero-shot MLM encoder is **not** a drop-in for NLI equivalence; next step is supervised NLI head (Phase 1B) on the same fixture.

---

## 4. What we ask Liquid

- Joint review of Phase 1B fine-tune approach (MNLI probe → domain pairs).
- Guidance on recommended zero-shot / few-shot NLI patterns for LFM encoders if available.
- Path to self-hosted deployment once gates pass.

**Training plan:** [`TRAINING-PLAN.md`](./TRAINING-PLAN.md) — three-stage head curriculum (MNLI probe → domain adaptation → hard-negative refine).
