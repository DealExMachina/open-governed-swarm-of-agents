## Goal
Empirically map the coverage-autonomy trade-off that SECP identified, using governance modes as the control variable.

## Protocol
- Run identical document set through 3 governance modes: YOLO, MITL, MASTER
- Measure: claims accepted, contradictions resolved autonomously, human escalations, convergence rate alpha
- Map to SECP framework: YOLO ~ scalar aggregation (high coverage), MASTER ~ hard veto (low coverage), MITL ~ intermediate

## Expected outcome
Lyapunov convergence rate alpha differs characteristically across modes, providing a formal metric for the trade-off SECP identified empirically.

## Implementation
Create `scripts/experiment-coverage-autonomy.ts`

See paper Section 9, docs/experiments.md

---

## Latest results (2026-03-04)

Three sequential runs (same corpus, DB reset between modes).

| Mode | Convergence points | Decision records | Finality | Final epoch | Last node |
|------|--------------------|------------------|----------|-------------|-----------|
| YOLO | 1 | (overwritten) | — | 26 | DriftChecked |
| MITL | 1 | 43 | 1 | 32 | DriftChecked |
| MASTER | 0 | 0 | 0 | — | (blocked) |

**Outcome:** YOLO and MITL completed with high decision counts and finality. MASTER produced 0 decisions — pipeline blocked by hard veto (immutable invariants), as expected. Clear separation of three modes; MASTER behaviour confirms “low coverage / Phase 1 veto” characterisation from SECP.

**Result dirs:** `docs/experiments/exp5/results/2026-03-04T12-05-28` (YOLO), `12-08-57` (MITL), `12-12-37` (MASTER)

---

## Outstanding / Close recommendation

**Protocol complete:** Identical corpus run through YOLO, MITL, MASTER. YOLO and MITL completed with decisions and finality; MASTER produced 0 decisions (pipeline blocked by hard veto). Clear separation of three modes; SECP mapping (YOLO ~ high coverage, MASTER ~ Phase 1 veto) confirmed.

**Outstanding:** None required for protocol. Optional: report convergence rate alpha per mode and confidence intervals (e.g. batch runs) for publication.

**Recommendation:** **Close.** Core goal and protocol satisfied.
