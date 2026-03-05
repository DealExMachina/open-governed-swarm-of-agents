## Goal
First empirical data on how governed agent coordination scales. Addresses SECP Section 8.6 item 4.

## Protocol
- Vary claims: 10, 50, 100, 500, 1000
- Vary contradiction rate: 10%, 30%, 50%
- Vary agent count: 3, 5, 7, 12
- Fixed: governance mode (YOLO), finality thresholds
- Measure: rounds to convergence, wall-clock time, LLM token consumption, audit event count

## Expected outcome
Identification of scaling bottleneck (likely contradiction resolution, not claim extraction); empirical validation of O(n * k) complexity bound.

## Implementation
Create `scripts/experiment-scalability.ts`

See paper Section 9, docs/experiments.md

---

## Latest results (2026-03-04)

Run: 50-claim corpus, 7 rounds.

| Metric | Value |
|--------|--------|
| Convergence points | 31 |
| Decision records | 28 |
| Finality | 0 |
| Final epoch | 24 |
| Last node | ContextIngested |

**Outcome:** Facts extraction not fully exercised in 7 rounds; pipeline stopped at ContextIngested. System sustained multiple rounds under moderate scale with no failures or CAS storms. Full scalability matrix (claims × rho × agents) remains to be run for full protocol.

**Result dir:** `docs/experiments/exp2/results/2026-03-04T11-54-06`

---

## Outstanding / Close recommendation

**Core goal partially achieved:** Single-scale run (50 claims, 7 rounds) completed; no failures or CAS storms. Pipeline stopped at ContextIngested (facts extraction not fully exercised in 7 rounds).

**Outstanding:** Full protocol requires varying claims (10, 50, 100, 500, 1000), contradiction rate (10%, 30%, 50%), and agent count (3, 5, 7, 12). No scalability matrix has been run; bottleneck identification and O(n·k) validation pending.

**Recommendation:** Leave open until at least one full scalability matrix (e.g. claims × rho) is run and documented.
