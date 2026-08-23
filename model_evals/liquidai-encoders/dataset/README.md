# Issue 01 — domain NLI labeled dataset

Hand-labeled claim pairs for Liquid AI Track A NLI fine-tune (PRD benchmark B4).

**Canonical copy on Hugging Face:** [jeanbaptdzd/liquid-nli-domain-1k](https://huggingface.co/datasets/jeanbaptdzd/liquid-nli-domain-1k)

```bash
bash scripts/download-liquid-nli-dataset.sh
# or: python build_domain_dataset.py  (from seeds/)
```

**Issue:** `.github/issue-liquidai-01-dataset-body.md`  
**Builder:** `../build_domain_dataset.py`  
**Training plan:** `../TRAINING-PLAN.md` Stage 2

---

## Files

| File | Purpose |
|------|---------|
| `pairs.jsonl` | Full corpus (generated) — **download from HF or rebuild** |
| `train.jsonl` | 70% train split — **download from HF or rebuild** |
| `eval.jsonl` | 30% eval split — **download from HF or rebuild** |
| `split_manifest.json` | Counts, split metadata, validation status |
| `spot-check-sample.jsonl` | 20% random sample for label review |
| `seeds/domain-pairs.yaml` | Hand-labeled source of truth (edit here) |
| `schema.json` | JSON schema for each row |

---

## Row schema

Each JSONL line:

```json
{
  "id": "ds1-arr-paraphrase-01",
  "a": "ARR €50M (FY 2024, self-reported)",
  "b": "Annual recurring revenue of fifty million euros for fiscal year 2024",
  "dimension": "arr",
  "label": "equivalent",
  "source_scenario": "s1",
  "source_doc": "demo/scenario/docs/01-analyst-briefing.txt",
  "lang": "en"
}
```

**Labels** match `NliLabel` in `src/nliGate.ts`:

| Label | Meaning | Typical SGRS categories |
|-------|---------|-------------------------|
| `equivalent` | Mutual entailment candidate | paraphrase |
| `contradiction` | Block signal | contradiction, refutation |
| `neutral` | Gray zone / no auto-merge | false_positive_trap, ambiguous_hitl |

---

## Labeling methodology

1. **Source mining** — Pairs authored from S1–S5 scenario docs (M&A, Solvency II, clinical, AML/KYC, energy grid) plus green-bond FR/DE variants. Text uses **variant wording** distinct from frozen regression fixtures.

2. **Tri-class assignment** — Each pair labeled for the **dominant NLI reading** at the equivalence gate:
   - Paraphrase / same fact → `equivalent`
   - Explicit negation, incompatible values, refutation → `contradiction`
   - Same dimension different period/value, accrual, partial overlap → `neutral`

3. **Regression isolation** — Pairs whose normalized `(a, b)` text appears in `test/fixtures/nli-gold-set.yaml` or `nli-held-out.yaml` are **excluded** at build time. Gold/held-out remain harness-only.

4. **Multilingual subset** — French and German pairs for S1 (M&A) and green-bond (EUGBS context), plus S2 SCR examples. Minimum 20 non-English pairs.

5. **Split** — Stratified 70/30 by label, `random.seed(42)`. Do not reshuffle without bumping `split_manifest.json` version and re-recording downstream benchmarks.

---

## Spot-check log (20% sample)

Second-pass self-review on `spot-check-sample.jsonl` (logged 2026-08-19):

| Reviewer | Sample size | Date | Result |
|----------|------------:|------|--------|
| JB (author) | 20% of corpus | 2026-08-19 | **Pass** — no label changes required on spot-check sample |

Notes from review:

- FP-trap rows correctly labeled `neutral`, not `contradiction` (numeric restatement without explicit negation).
- Refutation rows labeled `contradiction` (strong overturn of established fact).
- FR/DE paraphrase pairs checked for semantic alignment with English equivalents.

To reproduce spot-check sample:

```bash
python model_evals/liquidai-encoders/build_domain_dataset.py
# inspect dataset/spot-check-sample.jsonl
```

---

## Build / validate

```bash
cd agents-swarm-governed

# Validate counts only
python model_evals/liquidai-encoders/build_domain_dataset.py --check-only

# Generate JSONL artifacts
python model_evals/liquidai-encoders/build_domain_dataset.py
```

**Acceptance criteria (Issue 01):**

| Criterion | Target |
|-----------|--------|
| Total pairs | ≥ 150 |
| Per label (`equivalent`, `contradiction`, `neutral`) | ≥ 30 each |
| Multilingual (`lang` ≠ `en`) | ≥ 20 |
| Fixed train/eval split | `train.jsonl` / `eval.jsonl` |

---

## Downstream use

| Consumer | Split |
|----------|-------|
| `train_domain_nli.py` (Stage 2) | `train.jsonl` (+ optional 20% MNLI mix) |
| B4 macro-F1 benchmark | `eval.jsonl` |
| Frozen safety regression | `test/fixtures/nli-gold-set.yaml` (separate) |

Do **not** merge gold-fixture pairs into this dataset.

---

## Editing workflow

1. Add or edit rows in `seeds/domain-pairs.yaml`
2. Run `build_domain_dataset.py`
3. Review `split_manifest.json` counts
4. Spot-check new/changed IDs in `spot-check-sample.jsonl`
5. Commit seeds + generated JSONL + updated manifest together
