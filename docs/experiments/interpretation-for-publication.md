# Interpretation of Results for Publication

Summary of clean run (exp1–exp6), noisy corpus, and financial consolidation, for use in the paper (e.g. Section 9 / Results, Discussion). Latest full run: [RUN-2026-03-04-all.md](RUN-2026-03-04-all.md).

---

## 1. Convergence dynamics (Exp. 1)

- **Setup:** 7 rounds, 3 contradictions, progressive resolution at rounds 5–7.
- **Outcome (2026-03-04):** 41 convergence history points, 33 decision records; pipeline reached FactsExtracted (epoch 31). Final V ≈ 0.25, goal_score ≈ 0.75; dimension scores show contradiction_resolution = 1 after resolution.
- **Publishable:** Multi-iteration convergence with explicit resolution injection; V(t) tracks epistemic state and decreases with resolution, as in the theory.

---

## 2. Scalability (Exp. 2)

- **Setup:** 50-claim corpus, ρ = 0.3, 7 rounds.
- **Outcome (2026-03-04):** 31 convergence points, 28 decision records; final node ContextIngested (epoch 24). Facts extraction not fully exercised in 7 rounds.
- **Publishable:** System sustains multiple rounds under moderate scale; no failures or CAS storms.

---

## 3. Finality robustness (Exp. 3)

- **Setup:** Spike-and-drop pattern (4 documents: high confidence then contradiction).
- **Outcome (2026-03-04):** Pipeline reached FactsExtracted (epoch 10). Adversarial pattern processed without false finality.
- **Publishable:** Gates and governance (sgrs) allow the pipeline to advance while capturing the contradiction pattern; no premature RESOLVED.

---

## 4. Multi-level governance (Exp. 4)

- **Setup:** Demo corpus, 7 rounds, simulate-mitl with finality auto-approve.
- **Outcome (2026-03-04):** 31 decision records, 1 scope_finality_decision; lastNode DriftChecked (epoch 29). Governance path and finality exercised.
- **Publishable:** End-to-end governance path and finality decision recorded; MITL simulation confirms that finality can be resolved and pipeline progresses.

---

## 5. Coverage–autonomy trade-off (Exp. 5)

- **YOLO (2026-03-04):** lastNode=DriftChecked (epoch 26). Maximum coverage: all proposals evaluated, pipeline advances.
- **MITL (2026-03-04):** 43 decision records, 1 finality, lastNode=DriftChecked (epoch 32). Human-in-the-loop path exercised; high coverage with simulated approval.
- **MASTER (2026-03-04):** 0 decision records, 0 finality. Pipeline effectively blocked; collection shows no state transitions. Confirms MASTER enforces maximal caution (hard veto on drift).
- **Publishable:** Clear separation of the three modes: YOLO (high coverage, high autonomy), MITL (high coverage, human gate), MASTER (low coverage, high veto). Governance mode is a control variable for the coverage–autonomy trade-off (e.g. SECP).

---

## 6. Full pipeline with resolver (Exp. 6)

- **Setup:** 7 rounds, resolution injection at rounds 5–7 (Assumption #3: monotonic progress).
- **Outcome (2026-03-04):** 33 decision records, 1 scope_finality_decision; lastNode=DriftChecked (epoch 23). Resolution batches applied; pipeline advanced to DriftChecked.
- **Publishable:** End-to-end run with resolver agent; resolution injection reduces contradictions and allows progression to finality.

---

## 7. Noisy corpus

- **Setup:** 5 documents from `docs-noisy` (ambiguous/hedging language), 5 rounds, simulate-mitl.
- **Outcome (2026-03-04):** 2 convergence history points (sampled), 19 decision records, 1 scope_finality_decision; lastNode=ContextIngested (epoch 15).
- **Publishable:** Noisy corpus run shows the system can handle ambiguous input, record decisions, and reach a finality option. Suitable for the "Internal validity" / "noisy corpus" limitation in the paper; follow-up can compare V(t) and resolution rates across clean vs noisy with larger n.

---

## 8. Financial consolidation (dual temporality)

- **Setup:** 8 documents (consolidated summary, subsidiaries, restatement, comparatives, auditor, management response); resolution at rounds 7–8.
- **Outcome (2026-03-04):** 39 convergence points, 34 decision records; lastNode=DriftChecked (epoch 20). One contradiction remaining at final (expected: unresolved classification / methodology).
- **Publishable:** Bitemporal semantic graph handles multi-period reconciliation; V(t) non-monotonic under restatements; final state non-final when classification issues remain, as designed.

---

## 9. Policy engine (sgrs only)## 7. Policy engine (sgrs only)

- All decision records in this run use **binding: "sgrs"**. OPA has been removed; the sgrs-core Rust kernel is the sole policy engine for governance decisions. This simplifies the evaluation story and aligns the implementation with the intended design.

---

## Suggested paper wording (short)

- **Exp. 1:** “Multi-iteration convergence with resolution injection confirmed; V(t) decreases after resolution.”
- **Exp. 2:** “At N=50, ρ=0.3, the system produced 31 convergence points and 28 decisions over 7 rounds.”
- **Exp. 3:** “Spike-and-drop pattern processed without false finality; pipeline reached FactsExtracted.”
- **Exp. 4:** “Governance and finality path exercised; one scope finality decision with simulate-mitl.”
- **Exp. 5:** “YOLO and MITL showed high coverage and finality; MASTER produced 0 decisions, confirming hard veto behavior.”
- **Exp. 6:** “Full pipeline with resolver agent reached DriftChecked with resolution injection at rounds 5–7.”
- **Noisy:** “Noisy corpus run: decisions and one finality recorded; supports handling of ambiguous input.”
- **Financial:** “Financial consolidation run: bitemporal handling and non-final state when contradictions remain.”
- **Engine:** “All experiments use the sgrs kernel as the sole policy engine (binding sgrs).”

These bullets can be expanded into tables or paragraphs in the Results section and referenced in Discussion (internal validity, limitations, future work).
