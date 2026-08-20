# Open loops closed — 2026-08-20

Artifacts from closing the wd=0.1, DeBERTa threshold, and corpus expansion prep.

---

## 1. wd=0.1 Stage 3 refine — valid gold rerun

**Checkpoint:** `nli-domain-v2-wd01-refine`  
**Artifact:** `phase1f-wd01-refine-gold-minconf077-rerun.json` (valid run; NLI available on all 57 pairs)

| Metric | phase1e (230M calibrated) | wd=0.1 refine |
|--------|--------------------------:|--------------:|
| Routing accuracy | **66.7%** | 63.2% |
| False-merge rate | 0.0% | 0.0% |
| Block recall | **94.1%** | **82.4%** FAIL |
| HITL routing | 71.4% | 64.3% |
| Paraphrase accuracy | 53.3% (8/15) | **13.3%** (2/15) |

**Verdict:** Stage 3 + wd=0.1 is **rejected**. Collapses paraphrase and block recall. Original phase1f artifact (all `available:false`) was infra failure, not model death — but the model itself still fails safety vs phase1e.

---

## 2. DeBERTa @ minConf 0.77 (offline rescore)

**Source:** `baseline-deberta-v3-large-gold.json` (cached @ 0.70 run)  
**Artifact:** `baseline-deberta-v3-large-gold-minconf077-rescore.json`

| minConf | Routing | False-merge | Block recall |
|--------:|--------:|------------:|-------------:|
| 0.70 | 66.7% | 0.0% | 94.1% |
| 0.77 | 66.7% | 0.0% | 94.1% |

DeBERTa gold routing is **threshold-invariant** in [0.70, 0.77] on this set — no pairs flip merge/block decisions. LFM @ 0.77 is apples-to-apples on safety; routing gap (−3.5 pp) is real, not threshold mismatch.

---

## 3. Domain corpus expanded (synthetic FR/EN)

**Generator:** `generate_synthetic_domain_pairs.py`  
**Seeds:** `dataset/seeds/synthetic-domain-pairs.yaml` (823 synthetic) + 177 hand + 21 train-only mined

| Metric | Before | After |
|--------|-------:|------:|
| Total pairs | 183 | **1006** |
| Train / eval | 128 / 49 | **711 / 295** |
| EN / FR / DE | 150 / 16 / 11 | **580 / 415 / 11** |
| Per label (≈) | 60 / 58 / 59 | **338 / 338 / 330** |

Rebuild:

```bash
python model_evals/liquidai-encoders/generate_synthetic_domain_pairs.py --target 823
python model_evals/liquidai-encoders/build_domain_dataset.py \
  --min-total 1000 --min-per-label 330 --min-multilingual 400
```

Frozen gold regression (`test/fixtures/nli-gold-set.yaml`) unchanged.

---

## 4. HF Jobs — retrain required?

| Track | Retrain? | Why |
|-------|----------|-----|
| **230M production candidate** | **Yes — full v3 pipeline** | Train split grew 128→711; B4 eval 49→295; Liquid recipe (MNLI probe, wd=0.1 Stage 2 only) not yet applied on expanded data |
| **350M** | **No (unless re-opened)** | Failed block recall 76.5% on gold; routing upside does not justify safety regression |

### 230M v3 pipeline (next)

```bash
bash scripts/run-liquid-nli-stage2-recipe-230m.sh
```

Checkpoints: `nli-mnli-probe-v3` → `nli-domain-v3-liquid` → `nli-domain-v3-calibrated`

**Local MPS:** ~2–4 h total (MNLI 15k probe + 711 domain + refine).  
**HF Jobs:** Optional for Stage 1 MNLI probe only (`run-hf-l40-stage1-probe.sh` pattern); Stage 2–3 fine on local MPS with expanded corpus is feasible. Use HF L4 if MPS OOM on 15k MNLI probe.

### What does *not* need a new HF job

- DeBERTa rescore @ 0.77 — offline only
- wd01 gold rerun — done locally via Docker
- Gold harness regression — no retrain

---

## 5. Production recommendation (unchanged until v3 eval)

Stay on **230M phase1e** (`nli-domain-v2-calibrated`) until v3 Liquid-recipe checkpoints pass gold gates + B4 on new eval split.

**Rejected:** wd=0.1 Stage 3 refine, 350M for production NLI.
