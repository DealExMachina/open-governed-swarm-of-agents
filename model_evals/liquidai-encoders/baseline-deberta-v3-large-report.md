# NLI baseline — `cross-encoder/nli-deberta-v3-large`

**Phase:** 0 (Liquid Track A — encoder/NLI only)  
**Date:** 2026-08-19  
**Worker:** `http://127.0.0.1:8010` (facts-worker Docker, `SKIP_NLI=0`)  
**Harness:** `scripts/eval-nli-gold-set.ts` · minConfidence **0.7**  
**Pipeline:** `nliEntailment` → `shouldProposeEquivalence` → `decideEquivalence`

Embeddings and pgvector are **unchanged** (out of scope). This baseline is the bar for any **LFM2.5-Encoder** challenger.

---

## Headline metrics (gold set, n=57)

| Metric | Value | Liquid gate |
|--------|------:|-------------|
| **False-merge rate** | **0.0%** | Must stay **0%** |
| **Block recall** | **94.1%** | Must not regress materially |
| Full routing accuracy | 66.7% | Informational (typed pre-filter handles many paraphrases) |
| Missed-merge rate (paraphrase) | 60.0% | Expected — NLI is gray-zone only; typed canonicalisation merges first |
| HITL routing accuracy | 50.0% | Informational |
| Accrual over-block rate | 46.2% | Known pain: HITL pairs classified as contradiction |

**Safety verdict:** **PASS** for equivalence gate purposes (`falseMergeRate = 0`).

---

## By category (gold)

| Category | Accuracy | Notes |
|----------|----------|-------|
| false_positive_trap | **100%** (11/11) | Never auto-merges traps |
| refutation | **100%** (8/8) | Strong block signal |
| contradiction | 67% (6/9) | Some routing vs governance mismatch |
| paraphrase | 40% (6/15) | Many paraphrases resolved via typed path or neutral→no_merge |
| ambiguous_hitl | 50% (7/14) | Over-blocks to contradiction (S4 PEP/velocity/media) |

---

## By scenario (gold)

| Scenario | Accuracy |
|----------|----------|
| s3 (clinical) | 90% (9/10) |
| cross | 80% (4/5) |
| s5 (energy) | 67% (4/6) |
| s4 (AML/KYC) | 64% (9/14) |
| s1 (M&A) | 63% (10/16) |
| s2 (Solvency II) | 33% (2/6) |

---

## Held-out (n=6)

| Metric | Value |
|--------|------:|
| False-merge rate | **0.0%** |
| Block recall | **100%** |
| Accuracy | 50.0% |

Artifact: `baseline-deberta-v3-large-held-out.json`

---

## Latency (CPU, Docker)

| | |
|--|--|
| 57 gold pairs | **~136 s** wall-clock |
| Mean per pair | **~2.4 s** (bidirectional `/nli`) |

---

## Comparison to prior internal evals

| Run | Model | Gold accuracy | falseMergeRate |
|-----|-------|--------------:|---------------:|
| Jul 2026 sweep | deberta-v3-**small** | 68.4% | 0% |
| Jul 2026 | deberta-**base** + reversion prefilter | 77.2% | 0% |
| **This baseline** | deberta-v3-**large** | **66.7%** | **0%** |

Full routing accuracy on the gold set is **not** the production KPI (see fixture header: safety regression only). Prior small/base numbers used different routing or pair counts; **this run is the authoritative bar for `nli-deberta-v3-large`**.

---

## Reproduce

```bash
# facts-worker with SKIP_NLI=0, NLI_MODEL=cross-encoder/nli-deberta-v3-large
docker compose up -d facts-worker

cd agents-swarm-governed
FACTS_WORKER_URL=http://127.0.0.1:8010 npx tsx scripts/eval-nli-gold-set.ts \
  --out=model_evals/liquidai-encoders/baseline-deberta-v3-large-gold.json

FACTS_WORKER_URL=http://127.0.0.1:8010 npx tsx scripts/eval-nli-gold-set.ts \
  --gold=test/fixtures/nli-held-out.yaml \
  --out=model_evals/liquidai-encoders/baseline-deberta-v3-large-held-out.json
```

---

## Next step (Phase 1)

Run the same harness against **LFM2.5-Encoder-230M** (off-the-shelf, then fine-tuned). Challenger must match **falseMergeRate = 0** and block recall ≥ baseline before E2E replay.
