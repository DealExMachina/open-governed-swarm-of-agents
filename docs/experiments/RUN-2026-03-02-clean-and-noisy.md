# Experiment run 2026-03-02 (clean suite + noisy corpus)

Full clean run of experiments 1–5 and first batch run of the noisy corpus. Policy engine: sgrs only (OPA removed). All decision records use `binding: "sgrs"`.

## Result locations

| Experiment | Result dir | Final state | Notes |
|------------|------------|-------------|--------|
| **exp1** (convergence dynamics) | `exp1/results/2026-03-02T17-00-57` | epoch=22, lastNode=FactsExtracted | 7 rounds, contradictions=3, resolve-at=5,6,7. 26 convergence points, 24 decision records. |
| **exp2** (scalability) | `exp2/results/2026-03-02T17-05-06` | epoch=21, lastNode=ContextIngested | 7 rounds, 50 claims, rho=0.3. 30 convergence points, 24 decision records. |
| **exp3** (finality robustness) | `exp3/results/2026-03-02T17-07-52` | epoch=16, lastNode=FactsExtracted | 4 rounds, pattern=spike-and-drop. 18 convergence points, 17 decision records. |
| **exp4** (multi-level governance) | `exp4/results/2026-03-02T17-11-06` | epoch=26, lastNode=DriftChecked | Demo corpus, 7 rounds, simulate-mitl. 29 decision records, 1 scope_finality_decision. |
| **exp5** (coverage–autonomy) | `exp5/results/2026-03-02T17-15-07` (YOLO) | epoch=29, lastNode=DriftChecked | 31 decision records, 1 finality. |
| | `exp5/results/2026-03-02T17-18-50` (MITL) | epoch=25, lastNode=FactsExtracted | 29 decision records, 1 finality. |
| | `exp5/results/2026-03-02T17-22-27` (MASTER) | — | 2 decision records, 0 finality; pipeline largely blocked. |
| **noisy** (ambiguous corpus) | `noisy/results/2026-03-02T17-24-23` | epoch=18, lastNode=ContextIngested | 5 docs (docs-noisy), 6 convergence points, 20 decision records, 1 finality. V(0)≈0.56, V(final)≈0.26 after resolution. |

## Quick comparison

- **exp1**: Pipeline end-to-end; resolution at 5,6,7; final V low (0.25), goal_score 0.73.
- **exp2**: Scalability corpus; final node ContextIngested (downstream not fully exercised in 7 rounds).
- **exp3**: Spike-and-drop; pipeline reached FactsExtracted.
- **exp4**: Governance + simulate-mitl; finality approved; lastNode DriftChecked.
- **exp5**: YOLO and MITL advanced (29–31 decisions, finality); MASTER produced only 2 decisions (blocking as designed).
- **noisy**: Higher initial Lyapunov (0.56 vs ~0.25 for clean demo); contradiction_resolution 0→1; one finality decision; pipeline to ContextIngested.

## How to run

```bash
# Full suite (exp1 → exp5)
bash scripts/run-experiment.sh exp1
bash scripts/run-experiment.sh exp2
# ... exp3, exp4, exp5

# Noisy corpus (after suite or standalone)
bash scripts/run-experiment.sh noisy
```

## Analysis

- Batch analysis: `pnpm tsx scripts/analyze-experiment.ts docs/experiments/<exp_id>/results/<timestamp>`
- Decision binding: all records from this run use `binding: "sgrs"` (sgrs-core kernel only).
