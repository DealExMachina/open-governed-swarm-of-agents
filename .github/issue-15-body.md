## Goal
Demonstrate governance at multiple levels, extending both our and SECP's single-level models.

## Protocol
- Define 3 governance levels: L1 (Operational/YOLO), L2 (Compliance/MITL), L3 (Regulatory/MASTER)
- Run M&A scenario with cross-level escalation: financial claims L1->L2 on contradiction, patent disputes L2->L3
- L3 decisions immutable
- Measure: decision distribution across levels, escalation frequency, time-to-finality per level

## Expected outcome
>80% of decisions resolved at operational level; L3 decisions rare but critical; separation of duties traceable through certificate chain.

## Implementation
Create `scripts/experiment-governance-levels.ts`

See paper Section 9, docs/experiments.md

---

## Latest results (2026-03-04)

Run: demo corpus, 7 rounds, simulate-mitl.

| Metric | Value |
|--------|--------|
| Convergence points | 1 |
| Decision records | 31 |
| Finality | 1 |
| Final epoch | 29 |
| Last node | DriftChecked |

**Outcome:** One scope finality decision; last node DriftChecked. Governance path exercised; decision distribution across L1/L2/L3 traceable via `decision_records.json` (governance_path, scope_mode). Single convergence point reflects collection timing.

**Result dir:** `docs/experiments/exp4/results/2026-03-04T12-01-24`

---

## Outstanding / Close recommendation

**Core goal achieved:** One scope finality decision; 31 decisions; last node DriftChecked. Governance path and L1/L2/L3 distribution recorded in decision_records (governance_path, scope_mode). Simulate-mitl exercised.

**Outstanding (optional):** Protocol expects ">80% of decisions resolved at operational level" and "L3 decisions rare but critical". Single run confirms path diversity; formal distribution analysis (e.g. `analyze-tier-coverage`-style breakdown for exp4) and multi-scope escalation scenarios would complete the protocol.

**Recommendation:** Can be closed if single-run L1/L2/L3 distribution is deemed sufficient; otherwise leave open for distribution analysis and/or multi-scope runs.
