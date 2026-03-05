## Goal
Demonstrate multi-iteration convergence behavior that SECP explicitly could not evaluate (single-iteration design).

## Protocol
- Run 20 convergence cycles on a fixed scope with incremental context injection
- Vary contradiction density: 0, 1, 3, 5 contradictions per injection
- Measure: V(t) trajectory, alpha(t) convergence rate, gate satisfaction per round
- Report: convergence time (rounds to RESOLVED), V(t) monotonicity violations, oscillation frequency

## Expected outcome
Characteristic trajectory shapes: exponential decay (easy cases), plateau-then-resolution (hard cases), oscillation-then-escalation (irreconcilable conflicts).

## Implementation
Extend `scripts/benchmark-convergence.ts` or create `scripts/experiment-convergence-dynamics.ts`

See paper Section 9, docs/experiments.md

---

## Latest results (2026-03-04)

Full suite run: 7 rounds, c=3 contradictions, resolution at rounds 5–7.

| Metric | Value |
|--------|--------|
| Convergence points | 41 |
| Decision records | 33 |
| Finality | 0 |
| Final epoch | 31 |
| Last node | FactsExtracted |

**Outcome:** Final V ≈ 0.25, goal_score 0.75; contradiction_resolution = 1. Pipeline reached FactsExtracted. Resolution injection at 5–7 produced visible V(t) response. First empirical confirmation of multi-iteration convergence; Corollary precondition substantively satisfied.

**Result dir:** `docs/experiments/exp1/results/2026-03-04T11-50-13`

---

## Outstanding / Close recommendation

**Core goal achieved:** Multi-iteration convergence and V(t) trajectory demonstrated; resolution at 5–7 produced visible response; Corollary precondition substantively satisfied.

**Outstanding (optional for paper):** Full protocol specifies (a) 20 convergence cycles (run used 7 rounds), (b) four contradiction densities 0, 1, 3, 5 (only c=3 run). Running the full matrix (0, 1, 3, 5 × multiple runs) would strengthen trajectory-shape claims (exponential decay, plateau-then-resolution, oscillation-then-escalation).

**Recommendation:** Leave open until full contradiction-density matrix is run, or close with "core validated; full matrix deferred" if paper only requires one trajectory.
