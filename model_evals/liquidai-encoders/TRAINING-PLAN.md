# LFM2.5-Encoder NLI head — first training plan

**Track:** Liquid AI Phase 1B (PRD benchmark B4)  
**Model:** `LiquidAI/LFM2.5-Encoder-230M`  
**Baseline bar:** `cross-encoder/nli-deberta-v3-large` on frozen gold harness  
**Status:** Plan v0.1 — post zero-shot first shot (2026-08-19)

---

## 0. Objective

Train a **3-class sequence-classification head** on the LFM encoder so facts-worker `/nli` can replace DeBERTa CrossEncoder **without regressing SGRS safety gates**.

| Gate | DeBERTa baseline (gold, n=57) | Target for fine-tuned LFM |
|------|------------------------------:|--------------------------:|
| **False-merge rate** | 0.0% | **0.0%** (hard) |
| **Block recall** | 94.1% | **≥ 94%** |
| Routing accuracy | 66.7% | ≥ baseline (stretch) |
| CPU latency / pair | ~2.4 s | ≤ baseline (stretch) |

Zero-shot anchor probe (Phase 1A) **failed both gates** (14.3% false-merge, 17.6% block recall). This plan closes that gap in stages.

---

## 1. Head architecture

### 1.1 Model form

```
LiquidAI/LFM2.5-Encoder-230M  (bidirectional encoder backbone)
        ↓
AutoModelForSequenceClassification(num_labels=3)
        ↓
logits [contradiction, entailment, neutral]   # indices 0, 1, 2
```

- **Input:** `(premise, hypothesis)` tokenized pair — same contract as CrossEncoder / `rlm_facts.nli_entailment`.
- **Output:** 3 logits per direction; runtime applies softmax + **bidirectional fusion** (mutual entailment → `equivalent`; any-direction contradiction → `contradiction`).
- **Backend flag:** `LIQUID_NLI_MODE=finetuned`, checkpoint at `LIQUID_NLI_CHECKPOINT`.

### 1.2 What we are *not* training (yet)

| Head | Scope | Rationale |
|------|-------|-----------|
| Embedding head (`LFM2.5-Embedding`) | **Deferred** | pgvector migration out of scope |
| ColBERT reranker | **Deferred** | Follow-on PRD |
| Generative 8B equivalence | **Out of track** | NLI gate only |

This plan covers **one head:** tri-class NLI on Encoder-230M.

---

## 2. Label space and runtime mapping

Training labels must match production semantics in `rlm_facts.py` / `nliGate.ts`:

| Class index | Name | Runtime label | SGRS routing role |
|------------:|------|---------------|-------------------|
| 0 | contradiction | `contradiction` | Block / refutation path |
| 1 | entailment | `equivalent` (only if **both** directions) | Auto-merge candidate |
| 2 | neutral | `neutral` | HITL / no-merge |

**Bidirectional rule (non-negotiable):** eval and loss design must respect that `equivalent` requires A⇒B **and** B⇒A. Single-direction entailment → neutral at runtime.

**Category → supervision hint** (domain dataset only):

| Gold category | Primary label | Notes |
|---------------|---------------|-------|
| paraphrase | entailment (both dirs) | May need duplicated (A,B) and (B,A) rows |
| false_positive_trap | neutral or contradiction | Never entailment — weight heavily |
| contradiction | contradiction | Either direction sufficient at runtime |
| refutation | contradiction | Strong block signal |
| ambiguous_hitl | neutral | Gray zone |

---

## 3. Data strategy (three-stage curriculum)

### 3.0 Split discipline

| Set | Path | Use |
|-----|------|-----|
| **Frozen gold** | `test/fixtures/nli-gold-set.yaml` (57) | **Eval only — never train** |
| **Held-out** | `test/fixtures/nli-held-out.yaml` (6) | Eval only; optional early-stop hint |
| **Domain train/eval** | `model_evals/liquidai-encoders/dataset/train.jsonl` / `eval.jsonl` | Train + macro-F1 (Issue 01) |
| **Public NLI** | SNLI → MNLI → ANLI (optional) | Warm-start only |

Minimum domain corpus (Issue 01): **150 pairs**, **≥ 30 per class**, **70/30 train/eval split**, versioned and frozen before Stage 2.

**Status:** scaffold built — `dataset/pairs.jsonl` (162 rows after gold-fixture exclusion), see `dataset/README.md`.

### 3.1 Stage 1 — General NLI probe (warm-start)

**Goal:** Teach the head tri-class NLI syntax before domain nuance.

| Item | Choice |
|------|--------|
| Script | `train_mnli_probe.py` (exists) |
| Data | SNLI train (cap 8k) → upgrade to **MNLI matched** (cap 15k) for harder negatives |
| Epochs | 1 (probe) → 2 if eval accuracy < 75% |
| LR | `2e-5` |
| Batch | 16 (CPU) / 32 (GPU) |
| Checkpoint | `workers/facts-worker/checkpoints/nli-mnli-probe` |

**Exit criteria (Stage 1):**

- MNLI/SNLI dev accuracy **≥ 75%**
- Gold harness: false-merge **< 5%** (expect still failing block recall)
- Proceed to Stage 2 regardless — probe is capability check, not go/no-go

**Command:**

```bash
cd agents-swarm-governed
docker compose run --rm -e SKIP_NLI=0 facts-worker \
  python model_evals/liquidai-encoders/train_mnli_probe.py \
  --max-samples 8000 --epochs 1

# Eval
docker compose run -d --name asg-facts-liquid-nli --no-deps -p 8011:8010 \
  -e SKIP_NLI=0 -e NLI_BACKEND=liquidai -e LIQUID_NLI_MODE=finetuned \
  -e LIQUID_NLI_CHECKPOINT=/app/checkpoints/nli-mnli-probe facts-worker \
  sh -c "pip install -q -r requirements-full.txt && uvicorn app:app --host 0.0.0.0 --port 8010"

FACTS_WORKER_URL=http://127.0.0.1:8011 npx tsx scripts/eval-nli-gold-set.ts \
  --out=model_evals/liquidai-encoders/phase1b-mnli-probe-gold.json
```

### 3.2 Stage 2 — Domain adaptation

**Goal:** Align head with SGRS claim-pair patterns (M&A metrics, clinical endpoints, AML/KYC, etc.).

| Item | Choice |
|------|--------|
| Script | **New:** `train_domain_nli.py` (to build — extends probe trainer) |
| Init weights | Stage 1 checkpoint (`nli-mnli-probe`) |
| Data mix | **80% domain train** + **20% MNLI** (anti-forgetting) |
| Epochs | 3 max, early stop on domain eval macro-F1 |
| LR | `1e-5` (lower than probe) |
| Class weights | Up-weight **contradiction** and **neutral** vs entailment (traps are rare but costly) |
| Augmentation | Paraphrase noise, unit/currency variants, negation insert/delete on contradiction rows |

**Domain pair sources** (Issue 01 — build in parallel):

1. Scenario manifests S1–S5 (mined claim pairs, not gold-fixture IDs)
2. Known contradiction arcs (e.g. Project Horizon ARR restatement)
3. FP-trap templates: same dimension, different value/period
4. Optional: 20 multilingual pairs (FR/DE) — Stage 2b if English gates pass

**Exit criteria (Stage 2 — B4 gate):**

| Metric | Target |
|--------|--------|
| Domain eval macro-F1 | ≥ DeBERTa macro-F1 on same split (record baseline first) |
| Gold false-merge rate | **0.0%** |
| Gold block recall | **≥ 94%** |

Checkpoint: `checkpoints/nli-domain-v1`

### 3.3 Stage 3 — Hard-negative refinement (if Stage 2 misses gates)

**Goal:** Fix residual false-merges and missed blocks without full retrain.

| Technique | When |
|-----------|------|
| **Hard-negative mining** | Run Stage 2 model on gold failures → add to train set with corrected labels |
| **Focal loss** (γ=2) | If contradiction class still under-recalled |
| **Confidence calibration** | Tune `minConfidence` (0.6–0.85 sweep) on gold — **not** retrain |
| **Contradiction-only mini-epoch** | 1 epoch, LR `5e-6`, FP-trap + contradiction rows only |

Max **2 refinement rounds** before escalating to Encoder-350M or stopping with no-go.

Checkpoint: `checkpoints/nli-domain-v1-calibrated`

---

## 4. Training loop design

### 4.1 Loss

Default: **weighted cross-entropy** on single-direction labels.

Optional Stage 2+ add-on: **bidirectional consistency loss** on paraphrase rows:

```
L = CE(fwd) + CE(bwd) + λ · max(0, margin - min(P(ent|A,B), P(ent|B,A)))
```

Start with plain CE; add bidirectional term only if paraphrase recall on gold stays > 80% missed-merge.

### 4.2 Recommended hyperparameters

| Stage | LR | Epochs | Batch | Warmup | Weight decay |
|-------|-----|--------|-------|--------|--------------|
| 1 Probe (SNLI/MNLI) | 2e-5 | 1–2 | 16 | 10% steps | 0.01 |
| 2 Domain | 1e-5 | 2–3 | 16 | 5% | 0.01 |
| 3 Refine | 5e-6 | 1 | 8 | 0 | 0.01 |

**Class weights (starting point):** `[2.0, 1.0, 1.5]` for `[contradiction, entailment, neutral]`.

### 4.3 Hardware

| Environment | Use |
|-------------|-----|
| Docker facts-worker (CPU) | Smoke runs, ≤8k samples |
| Local MPS / CUDA | Stage 2 domain (recommended) |
| HF Jobs (optional) | Full MNLI + domain if local too slow |

Target wall-clock: Stage 1 < 2 h CPU; Stage 2 < 4 h GPU.

---

## 5. Evaluation protocol (after each checkpoint)

Run **in order** — stop early if false-merge > 0.

```
1. Domain eval split     → macro-F1, per-class P/R  (B4)
2. Gold harness (57)     → falseMergeRate, blockRecall  (hard gates)
3. Held-out (6)          → sanity check
4. Latency benchmark     → mean /nli latency on 20 random gold pairs
5. compare-nli-eval-reports.ts vs baseline-deberta-v3-large-gold.json
```

Artifact naming:

| Run | Output |
|-----|--------|
| Stage 1 | `phase1b-mnli-probe-gold.json` |
| Stage 2 | `phase1b-domain-v1-gold.json` |
| Stage 3 | `phase1b-domain-v1-calibrated-gold.json` |

Record manifest JSON for each (mirror `baseline-deberta-v3-large-manifest.json`).

---

## 6. Milestone schedule

| Week | Milestone | Deliverable |
|------|-----------|-------------|
| **W0** ✓ | Harness + zero-shot | `LIQUID-FIRST-SHOT.md`, baseline + zero-shot JSON |
| **W1** | Issue 01 dataset + Stage 1 probe | `dataset/train.jsonl`, `nli-mnli-probe/`, probe gold eval |
| **W2** | Stage 2 domain v1 | `train_domain_nli.py`, `nli-domain-v1/`, B4 macro-F1 report |
| **W3** | Gate pass or Stage 3 refine | Gold gates pass **or** documented no-go |
| **W4** | E2E replay (if gates pass) | Issue 07 — Δ HITL / finality on S3 subset |

**Go / no-go (B4):** If after Stage 3 gold **falseMergeRate > 0** or **blockRecall < 90%**, recommend **no NLI replacement** and keep DeBERTa; publish negative result in same report format.

---

## 7. Scripts to add (implementation backlog)

| Script | Purpose | Priority |
|--------|---------|----------|
| `train_mnli_probe.py` | Stage 1 (exists; extend MNLI option) | P0 |
| `train_domain_nli.py` | Stage 2 domain fine-tune | P0 |
| `build_domain_dataset.py` | Mine Issue 01 pairs from scenario manifests | P0 ✓ |
| `eval_nli_checkpoint.py` | Batch gold + held-out + latency in one call | P1 |
| `sweep_min_confidence.py` | Stage 3 calibration without retrain | P1 |
| `run-liquid-nli-phase1b.sh` | Orchestrate train → worker → eval | P1 |

---

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Gold set too small for training signal | Train on Issue 01 corpus; gold is **regression only** |
| Over-fit to paraphrase → false-merge | Heavy FP-trap weighting; never label traps as entailment |
| MNLI probe forgets domain | 20% MNLI mix in Stage 2; lower LR |
| Bidirectional entailment too strict | Accept missed-merge on paraphrase if typed path handles it; **never** trade false-merge for merge recall |
| Liquid encoder lacks NLI inductive bias | Stage 3 hard negatives; escalate to 350M only if 230M fails after refine |
| Training in Docker aborts | Use HF Jobs or host venv with `requirements-full.txt` |

---

## 9. Liquid AI collaboration asks

1. **Recommended fine-tune recipe** for Encoder-230M NLI (LR, pooling, head init).
2. **Published NLI / routing fine-tune examples** we should mirror.
3. Whether Liquid provides a **pre-trained NLI adapter** or expects full head training from MLM.
4. Review of Stage 2 domain label schema vs their zero-shot routing demos.

---

## 10. References

| Doc | Path |
|-----|------|
| PRD Track A | `docs/benchmarks/liquidai/encoders-eval-prd.md` |
| Issue 01 dataset | `.github/issue-liquidai-01-dataset-body.md` |
| Issue 05 fine-tune | `.github/issue-liquidai-05-nli-finetune-body.md` |
| Zero-shot first shot | `LIQUID-FIRST-SHOT.md` |
| DeBERTa baseline | `baseline-deberta-v3-large-report.md` |
| Probe trainer | `train_mnli_probe.py` |
| Runtime NLI | `workers/facts-worker/rlm_facts.py` (`nli_entailment`) |
