## Goal

Validate **Assumption #3 (Monotonic Progress)** and secondarily **Assumption #1 (Discretization)** from the paper's Unproven Formal Assumptions (Section 8.7). Corollary 1 requires that every convergence cycle can produce strict progress (Delta > 0) on at least one dimension when admissible resolutions exist.

## Protocol

- Run full pipeline with resolver on exp6 corpus (7 docs, resolvable contradictions).
- Measure: V(t), goal_completion advance, decision records, resolver-originated decisions.
- Optional: run `scripts/analyze-discretization.ts` on convergence_history to validate well-foundedness (min step epsilon).

## Latest results (2026-03-04)

| Metric | Value |
|--------|--------|
| Convergence points | 1 |
| Decision records | 33 |
| Finality | 1 |
| Final epoch | 23 |
| Last node | DriftChecked |

**Outcome:** goal_completion advanced; 1 scope finality; pipeline reached DriftChecked. Assumption #3 (monotonic progress precondition) empirically confirmed. Success criterion "goal_completion advances beyond 0.00" met.

## Outstanding

- [ ] **Discretization (A1):** Run `analyze-discretization.ts` on exp6 convergence_history and document empirical min step epsilon (or link to E3 in [#18](https://github.com/DealExMachina/swarm-of-governed-agents/issues/18) for full epsilon sweep).
- [ ] Optional: batch runs (e.g. 3 runs) for confidence intervals; document in paper.

## References

- Paper Section 8.7 (Assumptions 1 & 3), Section 9 (experiments).
- `docs/experiments/exp6/README.md`
- Result dir: `docs/experiments/exp6/results/2026-03-04T12-15-20`
- Formal hardening: [#18](https://github.com/DealExMachina/swarm-of-governed-agents/issues/18) (E3 Discretization sweep)
