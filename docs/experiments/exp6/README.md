# Experiment 6: Full Pipeline with Resolver Agent

## Purpose

Validate **Assumption #3 (Monotonic Progress)** from the publication's
"Unproven Formal Assumptions" section.

Corollary 1 requires that every convergence cycle produces strict progress
(Delta > 0) on at least one dimension. In Experiments 1-5, `goal_completion`
was permanently stuck at 0.00 because the **resolver agent** was never
enabled — contradictions were never resolved by an agent (only by manual
`--resolve-at` injection in the driver).

Exp 6 runs the full agent pipeline including the resolver, on a corpus
specifically designed with **resolvable contradictions**: documents that
first introduce contradictions and then provide clarifying evidence that
the resolver can use to judge contradictions as "resolved" or "noise".

## Secondary: Assumption #1 (Discretization)

When `CONVERGENCE_INSTRUMENTATION` is enabled (default), every convergence
point logs exact per-dimension f64 values and step sizes. Post-processing
with `scripts/analyze-discretization.ts` computes the empirical minimum
step epsilon per dimension, validating the well-foundedness assumption.

## Corpus Design

7 documents injected sequentially:

| Round | Document | Effect |
|-------|----------|--------|
| 1 | `01-baseline-assessment.txt` | Establishes baseline claims + goals + risks |
| 2 | `02-financial-contradiction.txt` | Contradicts revenue, growth, margin, client count |
| 3 | `03-cybersecurity-risk.txt` | Adds new contradictions (SLA, security posture) |
| 4 | `04-regulatory-update.txt` | Partially resolves regulatory + disclosure concerns |
| 5 | `05-revenue-reconciliation.txt` | Resolves financial contradictions with agreed figures |
| 6 | `06-security-remediation.txt` | Resolves cybersecurity contradictions |
| 7 | `07-final-position.txt` | Confirms resolution of all major contradictions |

## Expected Behavior

1. V(t) increases through rounds 2-3 as contradictions are injected
2. Resolver agent activates (triggered by drift/latest.json hash change)
3. Resolver processes contradictions from docs 4-6, marking some as resolved/noise
4. V(t) decreases through rounds 4-7 as contradictions are resolved
5. `goal_completion` advances beyond 0.00 for the first time
6. Corollary 1's precondition becomes substantively (not vacuously) satisfied

## Running

```bash
# Single run
./scripts/run-experiment.sh exp6 --rounds=7

# Batch (3 runs with aggregation)
./scripts/run-experiment-batch.sh exp6 3 --rounds=7

# Then analyze discretization
pnpm tsx scripts/analyze-discretization.ts docs/experiments/exp6/results/<timestamp>/convergence_history.json
```

## What to Check

- `convergence_history.json`: does `goal_completion` advance beyond 0.00?
- `decision_records.json`: are there resolver-originated decisions?
- V(t) trajectory: does it show monotonic decrease after round 4?
- Discretization report: are step sizes bounded away from 0?
