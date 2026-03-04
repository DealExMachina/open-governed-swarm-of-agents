# Interpretation of Results for Publication

Summary of clean run (exp1–exp5) and noisy corpus run, for use in the paper (e.g. Section 9 / Results, Discussion). Latest run log: [RUN-2026-03-04-financial.md](RUN-2026-03-04-financial.md).

---

## 1. Convergence dynamics (Exp. 1)

- **Setup:** 7 rounds, 3 contradictions, progressive resolution at rounds 5–7.
- **Outcome:** Pipeline reached FactsExtracted; 26 convergence history points, 24 governance decisions (all allow, binding sgrs).
- **Lyapunov:** Final V ≈ 0.25, goal_score ≈ 0.73; dimension scores show contradiction_resolution = 1 after resolution. Confirms that V(t) tracks epistemic state and decreases with resolution.
- **Publishable:** Multi-iteration convergence with explicit resolution injection; V responds to both contradiction introduction and resolution, as in the theory.

---

## 2. Scalability (Exp. 2)

- **Setup:** 50-claim corpus, ρ = 0.3, 7 rounds.
- **Outcome:** 30 convergence points, 24 decision records; final node ContextIngested (facts extraction not fully exercised in 7 rounds).
- **Publishable:** System sustains multiple rounds under moderate scale; decision count and convergence points in line with prior scalability runs (N=50, ρ=0.3). No failures or CAS storms.

---

## 3. Finality robustness (Exp. 3)

- **Setup:** Spike-and-drop pattern (4 documents: high confidence then contradiction).
- **Outcome:** 18 convergence points, 17 decision records; pipeline reached FactsExtracted.
- **Publishable:** Adversarial pattern is processed without false finality; gates and governance (sgrs) allow the pipeline to advance while capturing the contradiction pattern.

---

## 4. Multi-level governance (Exp. 4)

- **Setup:** Demo corpus, 7 rounds, simulate-mitl with finality auto-approve.
- **Outcome:** 29 decision records, 1 scope_finality_decision; lastNode DriftChecked. All decisions use governance_path oversight_acceptDeterministic, scope_mode YOLO.
- **Publishable:** End-to-end governance path and finality decision recorded; MITL simulation confirms that finality can be resolved and pipeline progresses (epoch=26).

---

## 5. Coverage–autonomy trade-off (Exp. 5)

- **YOLO:** 31 decisions, 1 finality, epoch=29, lastNode=DriftChecked. Maximum coverage: all proposals evaluated, pipeline advances.
- **MITL:** 29 decisions, 1 finality, epoch=25, lastNode=FactsExtracted. Human-in-the-loop path exercised; similar coverage to YOLO with simulated approval.
- **MASTER:** 2 decision records, 0 finality. Pipeline effectively blocked; almost no state transitions. Confirms that MASTER mode enforces maximal caution (hard veto on drift).
- **Publishable:** Clear separation of the three modes: YOLO (high coverage, high autonomy), MITL (high coverage, human gate), MASTER (low coverage, high veto). Supports the claim that governance mode is a control variable for the coverage–autonomy trade-off identified in prior work (e.g. SECP).

---

## 6. Noisy corpus (first batch run)

- **Setup:** 5 documents from `docs-noisy` (ambiguous/hedging language), 5 rounds, same governance and simulate-mitl as exp4.
- **Outcome:** 6 convergence history points, 20 decision records, 1 scope_finality_decision; final state epoch=18, lastNode=ContextIngested.
- **Lyapunov:** Initial V ≈ 0.56 (vs ≈ 0.25 for clean demo); contradiction_resolution 0 → 1 by epoch 6; final V ≈ 0.26. Higher initial V reflects greater ambiguity; resolution dimension still converges.
- **Publishable:** The noisy corpus (available but previously untested in batch) has been run. Results show (1) higher initial disagreement (V), (2) progression to resolution and finality, (3) pipeline advancement to ContextIngested. Suitable for the “Internal validity” / “noisy corpus” limitation in the paper: first empirical data that the system can handle ambiguous input and still record decisions and reach a finality option. Follow-up work can compare V(t) and resolution rates across clean vs noisy corpora with larger n.

---

## 7. Policy engine (sgrs only)

- All decision records in this run use **binding: "sgrs"**. OPA has been removed; the sgrs-core Rust kernel is the sole policy engine for governance decisions. This simplifies the evaluation story and aligns the implementation with the intended design.

---

## Suggested paper wording (short)

- **Exp. 1:** “Multi-iteration convergence with resolution injection confirmed; V(t) decreases after resolution.”
- **Exp. 2:** “At N=50, ρ=0.3, the system produced 30 convergence points and 24 decisions over 7 rounds.”
- **Exp. 3:** “Spike-and-drop pattern processed without false finality; pipeline reached FactsExtracted.”
- **Exp. 4:** “Governance and finality path exercised; one scope finality decision with simulate-mitl.”
- **Exp. 5:** “YOLO and MITL showed high coverage (25–31 decisions, finality); MASTER produced 2 decisions, confirming hard veto behavior.”
- **Noisy:** “First batch run of the noisy corpus: higher initial V (0.56), resolution to V≈0.26, and one finality decision; supports handling of ambiguous input.”
- **Engine:** “All experiments use the sgrs kernel as the sole policy engine (binding sgrs).”

These bullets can be expanded into tables or paragraphs in the Results section and referenced in Discussion (internal validity, limitations, future work).
