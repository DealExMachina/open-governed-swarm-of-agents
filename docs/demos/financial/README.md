# Financial consolidation (dual temporality)

> Back to [demos README](../README.md) | Corpus: `demo/scenario/docs-financial/`

## Goal

Demonstrate that the bitemporal semantic graph and the six-gate finality mechanism (A-F) handle **multi-period financial statement reconciliation** — a domain where dual temporality (valid time vs. transaction time) is structurally necessary.

Holding company consolidation: three subsidiaries report overlapping metrics with different accounting methodologies, figures are restated across periods, and an external auditor introduces further ambiguity.

## Scenario: Meridian Holdings H1 2025

Meridian Holdings consolidates three subsidiaries: Alpha Industrials (manufacturing), Beta Services (consulting), and Gamma Digital (SaaS). The 8 documents arrive sequentially.

### Document injection order

| Round | Document | Valid period | Tx date | Role |
|-------|----------|-------------|---------|------|
| 1 | Consolidated Q1 summary | Q1 2025 | Apr 18 | Baseline |
| 2 | Alpha Industrials Q1 | Q1 2025 | Apr 14 | Contradicts group total; inter-company dispute |
| 3 | Beta Services Q1 | Q1 2025 | Apr 15 | Contradicts Alpha on inter-company |
| 4 | Gamma Digital Q1 | Q1 2025 | Apr 12 | Revenue methodology mismatch |
| 5 | Alpha Q1 restated | Q1 2025 (restated) | May 22 | Temporal restatement; supersedes doc 2 |
| 6 | Q2 preliminary with Q1 comparatives | Q2 2025 + Q1 restated | Jul 21 | Cross-period |
| 7 | EY interim review | H1 2025 | Aug 14 | Auditor observations |
| 8 | Management response | H1 2025 | Aug 28 | Partial resolution |

## Running

```bash
bash scripts/run-experiment.sh financial --rounds=8
# With resolution injection: --resolve-at=7,8
# Batch: bash scripts/run-experiment-batch.sh financial 3 --rounds=8
```

## Results

Results in `docs/experiments/financial/results/<timestamp>/`. Consistency check vs M&A: [COMPARISON-financial-vs-ma.md](../COMPARISON-financial-vs-ma.md).

## Scope isolation

Use a dedicated demo session/scope per run. Feed demo endpoints reject missing scope with `scope_required`.
