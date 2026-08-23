# Liquid AI × SGRS — LFM2.5-Encoder NLI evaluation wrap-up

**Date:** 2026-08-20  
**Contact:** Jean-Baptiste Dézard  
**Repository:** `agents-swarm-governed` (Track A — encoder NLI)  
**Scope:** Replace `cross-encoder/nli-deberta-v3-large` in the governed multi-agent stack with `LiquidAI/LFM2.5-Encoder` + fine-tuned 3-class head, CPU-only, fail-closed.

---

## Executive summary

We completed an end-to-end evaluation of **LFM2.5-Encoder NLI** against our production CrossEncoder baseline on a **frozen 57-pair gold harness** (governance routing + safety gates) and an **expanded 1,006-pair domain corpus** (711 train / 295 eval, FR/EN M&A · insurance · clinical · AML · cyber).

**Recommendation:** **Go** on **`LFM2.5-Encoder-230M`** with the **v3 Liquid recipe** (HF L4–trained checkpoint). It **passes all safety gates**, **beats DeBERTa v3 large on routing (+15.8 pp)**, and is **wired into facts-worker** as an opt-in backend (`NLI_BACKEND=liquidai`). NLI **blocks silent auto-merge** on contradiction and routes resolution to **HITL** — it is not a reject-and-forget gate.

**350M:** Trained on the same 1k corpus. **MPS-tuned 350M** exceeds 230M v3 on gold routing (87.7% vs 82.5%) with **100% block recall**; useful as an **optional upsize** if latency budget allows (~1.5× params). **350M on L4 requires recipe alignment** with MPS (refine weight decay 0.1, lower domain LR) — default L4 hyperparams over-fit refine and hurt gray-zone HITL routing.

Embeddings / pgvector swap remains **out of scope** for this memo.

---

## What we measured

| Layer | Description |
|-------|-------------|
| **Gold harness** | 57 frozen pairs · `test/fixtures/nli-gold-set.yaml` · minConfidence **0.77** · metrics: false-merge, block recall, HITL routing, accrual over-block |
| **B4 gate** | Macro-F1 on held-out **eval.jsonl** (n=295) vs DeBERTa baseline **0.730** |
| **Pipeline** | 3-stage Liquid recipe: MNLI probe → domain fine-tune (wd=0.1) → hard-negative refine (wd=0.01) |
| **Integration** | `workers/facts-worker` `/nli` · bidirectional mutual entailment · `{available, label, confidence}` · fail-closed |

Production reference: **`cross-encoder/nli-deberta-v3-large`** via `nliGate.ts` → facts-worker.

---

## Governance routing — block is not a dead end

NLI is **Couche 2**: a safety gate on auto-merge, not the final arbiter. A **block** means *do not silently merge* — it does **not** mean *drop the pair*.

| Outcome | Auto-merge? | Next step in SGRS |
|---------|:-----------:|-------------------|
| **Equivalent** (conf ≥ minConf) | Yes | Governed `equivalent_to` edge (Couche 3) |
| **Equivalent** (conf < minConf), **neutral**, accrual / refinement | No | **HITL** — human adjudicates paraphrase or scope change |
| **Contradiction / refutation** | No | **Block auto-merge** → surface in semantic graph (`contradicts` edges) → **HITL/MITL** to resolve (keep prior, accept update, defer, add `resolves` edge) |
| **False-positive trap** (unrelated) | No | No merge; no contradiction workflow |
| **NLI unavailable** | No | Fail-closed neutral — never merge on guess |

```text
new claim ≠ existing node (lexical diff)
        │
        ▼
  Couche 0–1 (typed + embed pre-filter)
        │
        ▼
  Couche 2 NLI (/nli)
        │
        ├─ equivalent + conf OK ──► auto-merge (governed trace)
        ├─ ambiguous / accrual ──► HITL queue (never auto-merge)
        └─ contradiction ────────► block merge ──► HITL resolution loop
                                              (contradicts → human → resolves)
```

In the **gold harness**, contradiction pairs are labeled `block_contradiction` — that is the **NLI gate outcome** (block silent merge). In production, that same outcome feeds the **contradiction-resolution** workflow (B5 HITL seed: 2 `contradicts` + 1 `resolves`; one contradiction left for human review).

**How to read the metrics:**

| Metric | Meaning |
|--------|---------|
| **False-merge** | Worst failure — incompatible facts merged without review (**hard gate: 0%**) |
| **Block recall** | NLI correctly flags contradiction → **blocks auto-merge** so humans can resolve |
| **HITL routing** | Gray-zone pairs (accrual, refinement, partial overlap) reach human review **without** misclassification as hard contradiction |
| **Accrual over-block** | Failure mode — treating accrual/refinement as contradiction instead of HITL |

---

## Domain corpus (Issue 01)

| Stat | Value |
|------|------:|
| Total pairs | 1,006 |
| Train / eval | 711 / 295 |
| Labels | ~338 each (equivalent · neutral · contradiction) |
| Languages | EN 580 · FR 415 · DE 11 |
| Sources | Hand-curated seeds + synthetic domain generator + gold-failure mining |

Hub dataset: [`jeanbaptdzd/liquid-nli-domain-1k`](https://huggingface.co/datasets/jeanbaptdzd/liquid-nli-domain-1k)

```bash
bash scripts/download-liquid-nli-dataset.sh
# or rebuild: python model_evals/liquidai-encoders/build_domain_dataset.py
```

---

## Gold harness results (n=57, minConf 0.77)

Primary comparison — **governance routing accuracy** and **safety gates**:

| Model | Checkpoint / Hub | Routing | False-merge | Block recall | HITL routing | Accrual over-block |
|-------|------------------|--------:|------------:|-------------:|-------------:|-------------------:|
| DeBERTa v3 large | production baseline | 66.7% | **0.0%** | 94.1% | 50.0% | — |
| LFM **230M v3** (L4) | [`lfm25-nli-v3-calibrated-l4`](https://huggingface.co/jeanbaptdzd/lfm25-nli-v3-calibrated-l4) | **82.5%** | **0.0%** | **94.1%** | **85.7%** | 15.4% |
| LFM 350M (MPS, 1k) | local `nli-domain-350m-v1-calibrated` | **87.7%** | **0.0%** | **100%** | **100%** | **0.0%** |
| LFM 350M (L4 retuned) | [`lfm25-nli-350m-v1k-mps-recipe-l4`](https://huggingface.co/jeanbaptdzd/lfm25-nli-350m-v1k-mps-recipe-l4) | 86.0% | **0.0%** | **100%** | 92.9% | 7.7% |
| LFM 350M (L4 default) | [`lfm25-nli-350m-v1k-calibrated-l4`](https://huggingface.co/jeanbaptdzd/lfm25-nli-v1k-calibrated-l4) | 77.2% | **0.0%** | 94.1% | 64.3% | 38.5% |

**Safety gate definition:** false-merge = 0% (hard) · block recall ≥ 94.1% (match DeBERTa).

**Production pick:** **230M v3 L4** — best balance of safety, routing gain vs DeBERTa, CPU footprint, and reproducible Hub artifact.

**Artifacts:** `phase2g-refine-v3-gold-minconf077.json` · `phase350m-1k-refine-gold-minconf077.json` · `phase350m-1k-mps-recipe-l4-gold-minconf077.json`

---

## B4 macro-F1 (eval split, n=295)

| Model | macro-F1 | vs DeBERTa (0.730) |
|-------|----------:|---------------------|
| DeBERTa v3 large | **0.730** | baseline |
| LFM 230M v3 (HF Trainer eval) | **0.959** | +0.229 |
| LFM 350M (domain eval, MPS/L4) | **~0.959–0.966** | +0.229–0.236 |

Gate: challenger ≥ baseline — **PASS** for all fine-tuned LFM runs on expanded split.

---

## Training summary

| Run | Encoder | Infra | Corpus | Hub output | Gold verdict |
|-----|---------|-------|--------|------------|--------------|
| v3 | 230M | HF L4 ~5 min | 1k | `lfm25-nli-v3-calibrated-l4` | **Go (production candidate)** |
| 350M | 350M | Mac MPS ~14 min | 1k | local only | **Go (optional upsize)** |
| 350M | 350M | HF L4 ~8 min (default recipe) | 1k | `lfm25-nli-350m-v1k-calibrated-l4` | No-go (HITL over-block) |
| 350M | 350M | HF L4 ~1 min (MPS-recipe refine-only) | 1k | `lfm25-nli-350m-v1k-mps-recipe-l4` | Near MPS; not default |

**Recipe lesson (350M L4):** Stage-3 refine with **wd=0.01** and **2× domain LR** drove refine `train_loss` to **0.001** (vs **0.06** on MPS), collapsing gray-zone pairs to high-confidence contradiction. Retune with **refine wd=0.1**, **domain lr=1e-5**, and/or **refine-only from MPS domain checkpoint** restored gold performance.

**Rejected paths:** 350M on small (~186-pair) corpus (block recall 76.5%) · wd=0.1 Stage-3 refine on 230M (block recall 82.4%) · zero-shot LFM probe (gates fail as expected).

---

## Integration status (facts-worker)

230M v3 is **wired** for opt-in production trials:

```bash
SKIP_NLI=0
NLI_BACKEND=liquidai
LIQUID_NLI_MODE=finetuned
# auto-resolves: checkpoints/nli-domain-v3-calibrated
EQUIV_MIN_CONFIDENCE=0.77
```

- Default backend remains **CrossEncoder** (unchanged for existing deployments).
- Issue 06 smoke: paraphrase + contradiction pairs via live `/nli` — **PASS**.
- B5 HITL NLI replay artifact: `b5-hitl-nli-replay-v3.json`.

Pull production checkpoint:

```bash
hf download jeanbaptdzd/lfm25-nli-v3-calibrated-l4 \
  --local-dir workers/facts-worker/checkpoints/nli-domain-v3-calibrated
```

---

## Reproducibility

| Resource | Location |
|----------|----------|
| Gold harness | `scripts/eval-nli-gold-set.ts` + `test/fixtures/nli-gold-set.yaml` |
| HF v3 pipeline | `scripts/run-hf-l4-full-pipeline-v3.sh` |
| HF 350M MPS-recipe | `scripts/run-hf-l4-350m-mps-recipe.sh` |
| Local gold eval (fast) | `LIQUID_GOLD_EVAL_LOCAL=1 bash scripts/run-liquid-nli-gold-eval.sh …` |
| Training scripts Hub | [`jeanbaptdzd/liquid-nli-scripts`](https://huggingface.co/jeanbaptdzd/liquid-nli-scripts) |
| Internal PRD | `docs/benchmarks/liquidai/encoders-eval-prd.md` |

HF Jobs (completed): v3 `6a872e40…` · 350M default `6a87391…` · 350M retune `6a874720…`

---

## Per-component verdict

| Component | Verdict | Notes |
|-----------|---------|-------|
| **LFM2.5-Encoder-230M NLI (v3)** | **Go** | Safety-equivalent to DeBERTa; +15.8 pp routing; Hub checkpoint; integrated |
| **LFM2.5-Encoder-350M NLI** | **Go-with-caveats** | MPS 1k run beats 230M on gold; ~1.5× latency/params; L4 needs MPS-aligned recipe |
| **LFM embeddings** | **Deferred** | No change to pgvector / OpenAI embed path in this cycle |
| **Production default flip** | **Separate PR** | Env-flag trial recommended before default swap |

---

## Suggested next steps (Liquid AI × SGRS)

1. **Joint review** of v3 checkpoint + gold failure analysis (10 remaining routing misses — mostly typed-dimension paraphrases where Couche 0 should merge before NLI).
2. **Optional:** Liquid-side review of 350M recipe (refine wd, probe size, SNLI mix) for a single canonical L4 training config.
3. **CPU latency benchmark (B3)** — P50/P95 `/nli` vs DeBERTa on identical hardware (upside already observed qualitatively on 230M).
4. **Controlled rollout** — `NLI_BACKEND=liquidai` on staging swarm; compare HITL rate and finality outcomes vs CrossEncoder (B5 full replay).

---

## One-line ask

We have a **reproducible, safety-certified, Hub-published LFM2.5-Encoder-230M NLI checkpoint** that improves governance routing over our DeBERTa production baseline without false merges. We would value Liquid AI feedback on the training recipe and interest in a **deeper 350M / multilingual** iteration aligned with your encoder roadmap.
