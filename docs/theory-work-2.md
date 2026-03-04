# Theory Work 2 — Extensive Review of Theoretical Foundations

**Date:** 2026-03-02
**Scope:** Full review of the theoretical apparatus across the paper (v5) and supporting docs.
**Purpose:** Identify strengths, gaps, inconsistencies, and next steps for publication-readiness.

---

## 0. Separation: Technical Infrastructure vs. Theory

The codebase mixes two distinct concerns. This document focuses exclusively on the **theoretical** work. Technical infrastructure (language choice, storage, FFI, Docker, NATS) is **not** part of the paper's contribution and has no bearing on the theoretical claims.

---

## 1. Inventory of Theoretical Claims

The paper makes the following formal or semi-formal claims:

| # | Claim | Location | Status |
|---|-------|----------|--------|
| C1 | Semantic graph G = (N, E) with typed nodes/edges and monotonicity constraints | Def 1–2, §3 | **Formalized** |
| C2 | Governance function Pi maps proposals to {Approve, Reject, Escalate} | Def 3, §3 | **Formalized** |
| C3 | Lyapunov disagreement function V(t) >= 0, V=0 iff convergence | Def 4, §3 | **Formalized** |
| C4 | Five-gate finality predicate F(t) = conjunction of G_A..G_E | Def 5, §3 | **Formalized** |
| C5 | Monotonic progress under CRDT constraints: V(t+1) <= V(t) when agents progress | Prop 1, §5 | **Proof sketch only** |
| C6 | Bounded convergence time: V(t) → 0 in at most K cycles | Corollary 1, §5 | **Stated, not proved** |
| C7 | O(nk) message complexity vs O(n²) for BFT | §3.5 | **Claimed, not proved** |
| C8 | Pressure-directed activation routes agents to bottleneck dimension | §5, docs/convergence | **Implemented, no formal property** |
| C9 | Trajectory quality Q ∈ [0,1] detects oscillation patterns | §5 (Gate C) | **Heuristic, no formal justification** |
| C10 | Perpetual finality lifecycle with certificate chains | §5.7 | **Architectural, no formal property** |
| C11 | Complementarity with SECP on 4 of 6 open questions | §2.4, §7, academic-strengthening-plan | **Argued narratively** |

---

## 2. Strengths

### 2.1 The Lyapunov framing is the right tool

Using a Lyapunov function for multi-agent convergence is textbook-correct (Olfati-Saber & Murray 2004). The adaptation to a knowledge-work context — where "agents" are LLM pipelines and "consensus" is finality over a semantic graph — is novel and well-motivated. The quadratic form penalizing larger gaps is a natural choice that creates gradient-like behavior without requiring differentiability.

### 2.2 Five-gate finality is architecturally sound

The decomposition into five orthogonal gates (monotonicity, evidence coverage, oscillation detection, quiescence, minimum content) is the paper's strongest design contribution. Each gate addresses a distinct failure mode with clean separation:

- **Gate A (monotonicity):** prevents transient spike false positives
- **Gate B (evidence + contradiction mass):** prevents finality on incomplete data
- **Gate C (trajectory quality):** catches oscillation patterns invisible to threshold checks
- **Gate D (quiescence):** prevents premature closure during active bursts
- **Gate E (minimum content):** blocks vacuous resolution

The ablation experiment (Exp 3) showing that gates-disabled produces 0% ESCALATED vs 7% with gates is an effective validation.

### 2.3 CRDT monotonicity gives structure to convergence

The three invariants (confidence ratchet, irreversible contradictions, staling-not-deletion) are well-chosen and directly enable the convergence argument. These aren't just implementation details — they're the formal mechanism that makes V(t) non-increasing under approved transitions. The connection to Laddad et al.'s CRDT merge semantics is appropriate.

### 2.4 The SECP positioning is precise

The complementarity framing (our convergence + their BFT = complete system) is well-argued and backed by specific mappings: our Lyapunov addresses their open question on multi-iteration dynamics; their Byzantine tolerance addresses our cooperative-agent assumption. The comparison table (Table 5) makes this concrete.

### 2.5 The threat model is honest

Explicitly stating "cooperative agents, trusted governance, trusted infrastructure, single-scope" as assumptions — and then showing how each could be relaxed — is the right approach for a first paper. The frank "what this paper does NOT demonstrate" section (§1.1) is strong.

---

## 3. Weaknesses and Gaps

### 3.1 Proposition 1 is too weak for a convergence guarantee

**The problem:** Proposition 1 says V(t+1) <= V(t) **if** at least one dimension makes progress. But it doesn't establish **that** progress happens. The proof sketch shows monotonicity is *preserved* but doesn't show it's *achieved*. This is like proving "if you walk forward, you get closer to the door" without proving "you will walk forward."

**What's missing:**
- A liveness argument: under what conditions do agents actually produce approved transitions that improve some dimension?
- A fairness condition: in the current architecture, activation filters could starve a dimension indefinitely.
- A bounded-time argument for Corollary 1: the claim that V → 0 "in at most K cycles" requires showing that K is finite, which requires that progress happens in every cycle (or at least infinitely often).

**Recommendation:** Either strengthen the proposition to include a liveness condition (e.g., "if the activation filter ensures each dimension is served within every M cycles, and the LLM extraction has non-zero probability of improving each dimension...") or explicitly downgrade it: "Proposition 1 guarantees monotonicity of V(t) along non-trivial transitions; whether such transitions occur depends on agent capabilities and is an empirical question validated in Section 7."

### 3.2 The convergence rate α is not a convergence rate

**The problem:** α = -ln(V(t)/V(t-1)) is the instantaneous log-ratio of consecutive V values. Calling it a "convergence rate" implies exponential decay V(t) = V(0)·e^{-αt}, which requires α to be approximately constant over time. In practice:

- α varies dramatically between rounds (high when a batch of contradictions is resolved, zero during plateau)
- The ETA formula assumes constant α — this is stated as a caveat but the formula is presented prominently
- Averaging α over 5 recent pairs helps smooth, but fundamentally, the system dynamics are not exponential

**Recommendation:** Present α as a "progress indicator" rather than a "convergence rate." The ETA formula should be framed as an estimate under the (strong) assumption of constant exponential decay, with the caveat that it's unreliable during non-stationary phases. Consider adding variance of α as an additional signal: high variance → unstable regime → ETA unreliable.

### 3.3 Trajectory quality Q is heuristic, not principled

**The problem:** The formula Q = max(0, 1 - 0.12 · min(direction_changes, 5)) with additional caps at 0.65 and 0.85 for autocorrelation/spike-drop is entirely heuristic. The constants (0.12, 5, 0.65, 0.85, -0.3) appear to be engineering choices without theoretical justification.

This isn't necessarily wrong — heuristics are fine in systems papers — but the paper presents Q alongside formally-defined gates without distinguishing their epistemic status. A reviewer will ask: "Why 0.12? Why 5? What changes if these are 0.15 and 4?"

**Recommendation:** Either:
1. **Justify empirically:** Run a sensitivity analysis of Q parameters across the benchmark scenarios. Show that the system is robust to ±20% variation in constants. This would be a good addition to Experiment 3.
2. **Frame as configurable heuristic:** Move Q's constants to finality.yaml, present them as tunable parameters alongside β, τ, ε, and note that the specific values are chosen conservatively for the M&A domain.

### 3.4 The four dimensions and their weights lack formal justification

**The problem:** The four convergence dimensions (claim_confidence 0.30, contradiction_resolution 0.30, goal_completion 0.25, risk_score_inverse 0.15) are presented as given. The weights sum to 1.0, which is necessary for normalization, but:

- Why these four dimensions and not others (e.g., evidence coverage, agent agreement)?
- Why these specific weights?
- How sensitive is convergence behavior to weight selection?
- The finality-design.md already notes that evidence_coverage should be a 5th dimension. If it's added, all weights must be re-calibrated.

**Recommendation:** Add a paragraph explaining that the dimension set and weights are domain-configurable (which they are via finality.yaml), and that the specific values used in validation represent a balanced configuration for M&A due diligence. Note that a formal sensitivity analysis of weights is deferred to Experiment 1. Consider proving that the convergence guarantee (Prop 1) holds for *any* positive weight assignment, which it should by construction.

### 3.5 The complexity bound O(nk) is too loose

**The problem:** "n agents, k cycles, O(nk) messages" is correct but unhelpful. The interesting question is: what determines k? The paper says k is bounded by the EXPIRED timeout (30 days) and bounded below by β + γ. This is a wide range. In validation, k = 12, but there's no argument for why k should be O(anything meaningful).

**Comparison:** SECP's O(n²) per round is a protocol-level complexity bound that holds regardless of input. Our O(nk) depends on k, which depends on input difficulty. The comparison is somewhat apples-to-oranges: they bound per-round cost, we bound total cost but with an unbounded k.

**Recommendation:** Acknowledge that k depends on input complexity and that the O(nk) bound is meaningful primarily in comparison to O(n²k) for a hypothetical BFT version of the same protocol. The contribution is the elimination of the n² factor per round, not the bounding of k.

### 3.6 No formal connection between Gates and V(t)

**The problem:** V(t) and the five gates are defined independently. V(t) is a scalar aggregate; the gates check specific conditions (monotonicity, evidence, oscillation, etc.). There's no formal statement of how they relate. Questions:

- Can V(t) = 0 while a gate fails? (Yes: Gate E blocks empty graphs where V = 0 vacuously.)
- Can all gates pass while V(t) > 0? (No: F(t) requires S(t) ≥ 0.92, which constrains V(t).)
- Do the gates together imply convergence? (No: they're necessary conditions for finality, not for convergence itself.)

**Recommendation:** Add a remark explicitly stating: "V(t) tracks convergence dynamics; the gates are finality preconditions. V → 0 is necessary but not sufficient for finality (gates may block). Gates passing is necessary but not sufficient (V may be above threshold). Together, they ensure that finality is declared only when convergence is genuine, stable, and well-evidenced."

### 3.7 The "proof sketch" for Proposition 1 has a gap in dimension 4

**The problem:** The proof claims risk_score is "computed from unresolved contradictions and missing evidence, both of which are non-increasing under approved transitions." But risk_score is actually computed as `sum of risk_delta from active assessments, clamped to [0,1]` (from semanticGraph.ts). New risk assessments can arrive that *increase* the risk score — e.g., the patent infringement suit in Document 4 introduces a new risk that raises V(t).

This means V(t) can *increase* when new risk-bearing evidence arrives, even under monotonic graph constraints. The proof sketch assumes all dimensions move toward targets, but new context injection can push them away.

**This is the most important theoretical gap in the paper.**

**Recommendation:** The proposition should be conditioned more carefully: "V(t+1) ≤ V(t) when the approved transition at cycle t satisfies monotonicity constraints *and no new context is injected*." When new context arrives (new documents, new claims), V(t) may spike upward — this is expected behavior, not a violation. The convergence guarantee applies *within a context epoch* (between injections), not globally. This distinction should be formalized, possibly as two regimes:
- **Intra-epoch:** V(t) is non-increasing (pure convergence)
- **Cross-epoch:** V(t) may spike on new context, then resume convergence

This actually strengthens the perpetual finality narrative: each context injection creates a new convergence challenge, and the system tracks it formally.

### 3.8 Phantom references persist in the .bib

**The problem:** The externally-modified references.bib restored three phantom references (duan2025/Aegean attributed to wrong authors, camacho2024/MACI nonexistent, laddad2024/CodeCRDT wrong venue/year) that were identified and removed in the previous session. Additionally:

- `delachica2026` in the .bib vs `delachica2025` in some .tex citations — out of sync
- The .tex cites `gaurav2025gaas` and `gho2025market` which don't exist in the current .bib
- `ruan2025` and `codecrdt2025` also missing from the .bib

**Recommendation:** Reconcile .tex and .bib before next compilation. The verified references from the previous review should replace the phantom entries.

---

## 4. Consistency Issues Across Documents

### 4.1 Test count discrepancies

- validation.md: "283 tests across 38 files"
- Paper (§7.2): "197 unit tests across 26 files"
- The convergence tracker test count also varies (18 in finality-design.md, 32 in validation.md)

These suggest the paper was written at an earlier point. Need to update paper numbers from the latest `pnpm test` output.

### 4.2 Gate naming inconsistency

- Paper (Def 5): Gates A–E where A=monotonicity, B=evidence, C=trajectory, D=quiescence, E=minimum content
- finality-design.md: Gates A–D where A=authorization stability, B=epistemic, C=progress, D=quiescence
- The finality-design.md moved Gate A (authorization) to the governance layer, leaving B, C, D. The paper has a *different* Gate A (monotonicity).

This creates confusion: "Gate A" in the paper is not the same as "Gate A" in finality-design.md. The paper's scheme (A=monotonicity through E=minimum content) is self-consistent but doesn't match the design docs.

**Recommendation:** Align terminology. Either rename the paper's gates to match the design docs' convention, or vice versa. The paper's scheme is cleaner for external readers; the design docs should be updated to match.

### 4.3 Governance modes MASTER vs YOLO semantics

- Paper (§4.3): "MASTER: Deterministic rule-based decisions without LLM rationale. Suitable for highest-sensitivity scenarios."
- governance-design.md: "MASTER: Bypasses all checks; immediate approval (master override)"
- architecture.md: "MASTER: Bypasses all checks; immediate approval (master override)"

These are contradictory. The paper describes MASTER as the most restrictive mode; the code docs describe it as the most permissive (bypass all checks, auto-approve). The experiment results (Exp 5) confirm the code behavior: "MASTER blocks all proposals" in the paper vs "immediate approval" in architecture.md.

**This needs immediate resolution.** The paper's framing and the implementation appear to tell different stories.

### 4.4 Experiment results: paper vs what's implemented

The paper's Section 7 describes specific experimental results (312 facts, 18 contradictions, 12 rounds, etc.) but the academic-strengthening-plan.md notes that "the five experiments are **defined** in the paper but **implementation scripts remain to be built**."

If the numbers in Section 7 come from the E2E script (manual run) and not from the formal experimental protocols, this should be stated clearly. The five proposed experiments (§9) are separate from the Project Horizon validation (§7).

---

## 5. Recommendations for Publication Readiness

### 5.1 Priority 1: Fix Proposition 1 (the convergence gap)

The proposition needs to explicitly handle the two-regime dynamics (intra-epoch convergence vs cross-epoch perturbation). This is a 2-paragraph fix but it's the most important theoretical correction. The current formulation is subtly wrong because it doesn't account for new context injection raising V(t).

### 5.2 Priority 2: Reconcile .bib and .tex

Clean out phantom references, sync cite keys, verify all references against actual ArXiv/publication records. This is mechanical but blocks compilation.

### 5.3 Priority 3: Run Experiments 1–3

Experiments 1 (convergence dynamics), 2 (scalability), and 3 (finality robustness) are the minimum for a credible empirical contribution. The experiment protocols are well-designed. The infrastructure (drive-experiment.ts, run-experiment.sh) appears ready. What's needed is execution and analysis.

### 5.4 Priority 4: Sensitivity analysis for heuristic parameters

Add Q-parameter sensitivity to Experiment 3. Add weight sensitivity to Experiment 1. This addresses the "why these constants?" question that reviewers will raise.

### 5.5 Priority 5: Update numerical claims

Test counts, fact counts, and timing data in the paper should match the latest codebase state.

### 5.6 Priority 6: Resolve MASTER mode contradiction

Decide whether MASTER means "most restrictive" (paper) or "bypass all checks" (implementation), update both, and re-run Experiment 5 if needed.

---

## 6. Theoretical Directions for Future Work

### 6.1 Stochastic convergence under LLM uncertainty

The current framework assumes deterministic dimension updates. Real LLM extraction is stochastic — the same document processed twice may yield different claims with different confidence scores. A stochastic convergence analysis (V(t) as a supermartingale under suitable conditions) would strengthen the theoretical contribution significantly.

### 6.2 Information-geometric interpretation

The Fisher-Rao metric on the space of agent beliefs (treated as probability distributions over claims) could provide a principled notion of "distance between agents" that goes beyond the current scalar V(t). This connects to the stratified manifold ideas explored in earlier sessions:

- Agent beliefs form a statistical manifold
- Convergence is geodesic flow toward agreement
- The current V(t) is a crude projection of this geometry onto a single scalar

This would be a substantial theoretical contribution for a follow-up paper.

### 6.3 Byzantine extension via SECP integration

The paper already sets this up with the SECP complementarity argument. The formal question: can SECP's non-compensable objection mechanism be expressed as an additional gate (Gate F: Byzantine stability) in the finality predicate? If so, the five-gate architecture extends naturally.

### 6.4 Cross-scope finality

The single-scope limitation is acknowledged. The theoretical challenge: define a hierarchical V(t) where parent scope convergence depends on child scope convergence, with formal composition guarantees. This connects to compositional verification in distributed systems.

---

## 7. Summary Assessment

**Overall quality:** Strong systems paper with a solid architectural contribution. The five-gate finality mechanism and the CRDT-Lyapunov combination are genuinely novel. The SECP positioning is excellent.

**Theoretical rigor:** Adequate for a systems/architecture paper, but Proposition 1 has a real gap (context injection regime) that needs fixing. The heuristic components (Q, weights, α-based ETA) should be better flagged as engineering choices rather than theoretical results.

**Experimental validation:** The Project Horizon scenario is a good proof of concept. The five proposed experiments would elevate the paper significantly. Priority: run Experiments 1–3.

**Publication readiness:**
- **ArXiv:** Ready after fixing Prop 1, reconciling .bib, and updating numbers. ArXiv has no peer review barrier.
- **Workshop (e.g., AAMAS, AAAI workshop on multi-agent coordination):** Needs Experiments 1–3 results.
- **Top venue (AAMAS main track, NeurIPS, ICML):** Would need the stochastic convergence analysis, formal proofs (not just sketches), and a more rigorous experimental evaluation with baselines and statistical tests.

---

*Files reviewed: `publication/swarm-governed-agents.tex`, `publication/references.bib`, `docs/convergence.md`, `docs/architecture.md`, `docs/finality-design.md`, `docs/governance-design.md`, `docs/validation.md`, `docs/experiments.md`, `docs/experiments/README.md`, `docs/agent-hatching-design.md`, `academic-strengthening-plan.md`.*
