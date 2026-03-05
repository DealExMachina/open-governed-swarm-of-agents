# Interpretation of Results for Publication

Summary of clean run with goal-aware stale protection (exp1-exp8, noisy, financial), for use in the paper (Section 9 / Results, Discussion). Run date: 2026-03-04.

**Key change:** Goal and risk nodes are now protected from stale marking in `syncFactsToSemanticGraph`. This allows `goal_completion` to advance when goals are resolved, unblocking V(t) -> 0.

---

## 1. Convergence dynamics (Exp. 1)

- **Setup:** 7 rounds, c=3 contradictions, progressive resolution at rounds 5-7.
- **Outcome:** 44 convergence points, 33 decisions, epoch 22. goal_completion advances from 0.00 to 1.00 at resolution rounds. V(t) reaches 0.0000 at epochs 9, 13, 17. Goal score reaches 1.0000.
- **Trajectory:** Sawtooth: V drops to 0 at resolution, rises to 0.008-0.022 as new docs introduce new goals. Final: V=0.0078, score=0.9559.
- **Publishable:** First empirical confirmation of V -> 0. Corollary precondition substantively satisfied.

---

## 2. Scalability (Exp. 2)

- **Setup:** 50-claim corpus, rho=0.3, 10 rounds.
- **Outcome:** 22 convergence points, epoch 8. goal_completion = 1.00 vacuously (synthetic docs have no goals). V starts at 0, rises to 0.30 with contradictions.
- **Publishable:** System sustains multiple rounds under moderate scale; no failures or CAS storms.

---

## 3. Finality robustness (Exp. 3)

- **Setup:** Spike-and-drop pattern (4 documents).
- **Outcome:** 17 convergence points, 11 epochs. V=0 at epochs 1-5 (score=1.0), spikes to 0.6 at epoch 6 (contradictions arrive, claim_confidence and contradiction_resolution drop to 0), partial recovery to 0.3 at epoch 11. goal_completion = 1.00 throughout (vacuously satisfied).
- **Publishable:** Gates correctly block finality after contradiction arrival. V=0 phase followed by spike demonstrates the spike-and-drop mechanism.

---

## 4. Multi-level governance (Exp. 4)

- **Setup:** Demo corpus, 7 rounds, simulate-mitl with finality auto-approve.
- **Outcome:** 1 convergence point, 30 decisions. goal_completion = 0.00 (demo corpus without resolution injection).
- **Publishable:** Governance path exercised; single convergence point reflects collection timing.

---

## 5. Coverage-autonomy trade-off (Exp. 5)

- **YOLO:** 2 convergence points, 23 decisions (20 deterministic, 3 yolo_override). goal_completion = 0.00 (no resolution injection).
- **MITL:** 1 convergence point, 40 decisions (all mitl_escalation).
- **MASTER:** 1 convergence point, 46 decisions (all policy_passed through full kernel).
- **Publishable:** Clear separation of three modes. goal_completion stays 0 because demo corpus has no `--resolve-at`; this is correct behavior (no resolution = no goal progress).

---

## 6. Full pipeline with resolver (Exp. 6)

- **Setup:** 7 rounds, resolution at 5-7. Corpus with resolvable contradictions.
- **Outcome:** 20 convergence points. goal_completion reaches 1.00 (oscillates 0/1 as new docs add goals). V min = 0.001, score max = 0.9824.
- **Publishable:** Exp 6 success criterion ("goal_completion advances beyond 0.00") now met.

---

## 7. Tier 2/3 routing (Exp. 7)

- **YOLO:** 37 pts, 32 decisions (31 Tier 1, 1 Tier 2), gc_max=1.00, V_min=0.00.
- **MITL:** 41 pts, 49 decisions (36 mitl_escalation, 13 processProposal), gc_max=1.00, V_min=0.00.
- **MASTER:** 40 pts, 40 decisions (28 allow, 12 reject/30%), gc_max=1.00, V_min=0.00.
- **Publishable:** All three modes show goal_completion reaching 1.00 and V reaching 0.00. MASTER rejects 30% of proposals due to policy violations.

---

## 8. Adversarial defense (Exp. 8)

- **baseline:** 39 pts, 24 decisions (3 yolo_override/12%), gc_max=0.00 (no resolution), V_min=0.25, max epoch 18.
- **inflate:** 70 pts, 28 decisions (9 yolo_override/32%), gc_max=1.00 (adversarial mutation), V_min=0.00, 10 RESOLVED snapshots, max epoch 18.
- **collude:** 70 pts, 41 decisions (8 yolo_override/20%), gc_max=1.00, V_min=0.00, 18 RESOLVED snapshots, max epoch 31 (oscillating V between 0 and 0.25).
- **Publishable:** Baseline correctly stays at gc=0 (no resolution); adversarial modes achieve false RESOLVED via mutation but cycle-based re-extraction limits each false window to 1-2 cycles. Collude extends run to 31 epochs (vs 18 baseline) due to oscillation.

---

## 9. Noisy corpus

- **Setup:** 5 documents from `docs-noisy`, 5 rounds.
- **Outcome:** 1 convergence point, 20 decisions. goal_completion = 0.00 (no resolution injection).
- **Publishable:** System handles ambiguous input. goal_completion at 0 is correct (no resolutions).

---

## 10. Financial consolidation

- **Setup:** 8 documents, resolution at rounds 7-8.
- **Outcome:** 45 convergence points, epoch 38. goal_completion reaches 1.00. V reaches 0.00 at epochs 24, 28-30, 36 (three convergence cycles). Sawtooth pattern matches Exp 1.
- **Publishable:** Domain-independent convergence confirmed. V -> 0 achieved in financial scenario with three distinct convergence-regress-reconvergence cycles.

---

## Cross-experiment summary

| Experiment | GC max | V min  | V=0 epochs | Score max |
|------------|--------|--------|------------|-----------|
| exp1       | 1.00   | 0.0000 | 5/44       | 1.0000    |
| exp2       | 1.00   | 0.0000 | 3/22       | 1.0000    |
| exp3       | 1.00   | 0.0000 | 5/17       | 1.0000    |
| exp4       | 0.00   | 0.2500 | 0/1        | 0.7500    |
| exp5       | 0.00   | 0.2510 | 0/1        | 0.7324    |
| exp6       | 1.00   | 0.0010 | 0/20       | 0.9824    |
| exp7       | 1.00   | 0.0000 | 2 per mode | 1.0000    |
| exp8       | 1.00   | 0.0000 | 19/70*     | 1.0000    |
| noisy      | 0.00   | 0.2593 | 0/1        | 0.6971    |
| financial  | 1.00   | 0.0000 | 5/45       | 1.0000    |

Experiments with gc=0 (exp4, exp5, noisy) use corpora without resolution injection -- goal_completion stays 0 because no resolutions are provided, which is correct behavior.
