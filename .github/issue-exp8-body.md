## Goal

Validate **Assumption #5 (Cooperative agent model)**. The paper states that all formal guarantees assume cooperative agents; no Byzantine/adversarial agents are modeled. Exp. 8 tests whether adversarial agents can cause false finality when the cooperative assumption is violated.

## Protocol

- Three sub-runs: baseline (no injection), inflate (compromised facts agent), collude (facts + drift).
- Corpus: exp6 (genuine contradictions). Governance: YOLO (most permissive).
- Measure: V(t), false finality rate, gate triggers, dimension inflation, cycle-based re-extraction effect.

## Latest results (2026-03-04 run; see interpretation-for-publication.md)

- **Baseline:** HITL, gc=0, V_min=0.25 (correct: no resolution).
- **Inflate:** Honest drift agent caught manipulation (e.g. 3× more overrides); cycle re-extraction flushes mutations.
- **Collude:** Ephemeral false RESOLVED windows (18 snapshots over 31 epochs); each window 1–2 cycles before re-extraction flushes. **Assumption #5 PARTIALLY VALIDATED:** cooperative model is structurally necessary; defense-in-depth from re-extraction limits impact.

## Outstanding

- [ ] **Formal boundary:** Document in paper/issue that formal Byzantine fault tolerance is out of scope; re-extraction defense is structural, not a proven bound. Optionally: state a concrete "recovery within K cycles" claim and test it (e.g. E5 in [#18](https://github.com/DealExMachina/swarm-of-governed-agents/issues/18) — adversarial compensation under scalar vs vector finality).
- [ ] Optional: run full exp8 suite in next batch and attach summary (baseline vs inflate vs collude metrics) to this issue.

## References

- Paper Section 8.7 (Assumption 5), Section 9 (Exp. 8).
- `docs/experiments/exp8/README.md`
- Formal hardening E5: [#18](https://github.com/DealExMachina/swarm-of-governed-agents/issues/18)
