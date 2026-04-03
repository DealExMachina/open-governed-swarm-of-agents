# Academic Strengthening Plan

**Overview:** Leverage the SECP paper's rigorous academic structure to strengthen the swarm-governed-agents publication: add formal problem definitions, explicit limitation boundaries, a scalability/convergence/finality experimental protocol, and multi-level governance analysis -- positioning your paper as the architectural answer to their open questions.

**Paper status (v5):** All structural elements implemented in `swarm-governed-agents.tex`. Formal definitions (Section 3), Scope and Boundaries (Section 8), Proposed Experimental Protocol (Section 9), Limitations (Section 10) are in place. The five experiments are **defined** in the paper but **implementation scripts** remain to be built. See [docs/experiments.md](../../docs/experiments.md) and GitHub issues for experiment implementation tracking.

**Stage 2:** The Stage 2 design (causal DAG, sheaf propagation, ISS cascade) adds formal verification targets (Phase 4) and Stage 2-specific experiments (E1-E7). The open snapshot intentionally omits Stage 2 planning/status documents.

---

## 0. Repositioning Update (2026-03-30): CALM/LVars and Topology-Spectral Framing

This update shifts the narrative from a failure-mode defense ("agents can drift/hallucinate") to a theorem-driven positioning:

- **Paper 1 framing:** monotonic governance is presented as the architectural consequence of CALM (coordination-free consistency iff monotonicity), not as a post-hoc robustness trick.
- **Paper 1 related work:** explicit CALM/LVars bridge added, with direct mapping from inflationary deltas and finality gates to monotone writes and threshold reads.
- **Paper 1 bibliography:** added CALM/LVars and recent LLM-MAS references (`hellerstein2019calm`, `ameloot2025calm`, `kuper2013lvars`, `codecrdt2025`, `topologylearning2025`).
- **Paper 2 related work:** GTD added as the closest dynamic-topology comparator; distinction clarified between topology learning and spectral/algebraic convergence guarantees.
- **Paper 2 validation positioning:** independent spectral-gap consensus result added as external support for E5-T's core claim.
- **Paper 2 discussion/novelty:** literature gap reformulated into three paths: fixed topology, learned topology, and monotone shared-state coordination (CALM-consistent route).

This is a **positioning reinforcement**, not a claim rewrite: central contributions remain unchanged (bilattice state, governance hierarchy, sheaf/ISS analysis, machine-checked components), but their theoretical lineage is now explicit and reviewer-facing.

---

## 0bis. Publication posture update (2026-03-31): FCA Path A

For publication consistency across documents:

- FCA is positioned as a **diagnostic research layer** over Stage 2, not as a
  stronger finality engine.
- Anti-circular hardening is considered a verified methodological contribution.
- Current strict outcomes are negative for incremental-value claims (`E25` fail,
  Stage2-vs-FCA fail), and are reported as such.
- Claim posture is frozen as:
  - `Verified`: methodological hardening and reproducibility,
  - `Exploratory`: structural FCA diagnostics,
  - `Blocked`: superiority/incremental-value claims over Stage 2.

---

## 1. Strategic Positioning: How to Leverage the SECP Paper

The SECP paper (de la Chica Rodriguez & Vera Diaz, 2026) and your paper are **complementary** -- they solve adjacent halves of the same problem:

| Dimension           | SECP paper                                          | Your paper                                             |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| Core question       | How do agents *aggregate decisions* over proposals? | How do agents *reason over shared state* and converge? |
| Coordination model  | Protocol-level (aggregation rules)                  | State-level (shared semantic graph)                    |
| Self-modification   | Protocol parameters evolve                          | Graph state evolves, policy is declarative             |
| Convergence         | Not demonstrated (single iteration)                 | Lyapunov-based with 5 formal gates                     |
| Auditability        | Empirical logs                                      | Bitemporal graph + Ed25519 certificates                |
| Byzantine tolerance | Assumed (BFT context)                               | Not addressed                                          |

**Your paper directly answers 4 of their 6 stated open questions** (Section 8.6 of SECP):

- Multi-iteration convergence dynamics -- your Lyapunov function + perpetual finality
- Formal invariant preservation -- your 5 gates + monotonicity tracking
- Audit trail infrastructure -- your bitemporal graph + signed certificates
- Complexity bounding under iteration -- your three-node cycle constrains state space

**Their paper addresses your acknowledged gaps:**

- Byzantine agents (your Section 9, "Byzantine agents" limitation)
- Non-scalar coordination (your system uses threshold-based scalar convergence)
- Protocol self-modification (your governance rules are static YAML)

**Citation strategy:** Cite them in Related Work under a new subsection "Self-Evolving Coordination Protocols" and position your convergence/finality mechanism as the formal foundation their architecture needs for multi-iteration deployment.

---

## 2. Structural Review: What to Add

### 2.1 Formal Problem Definition (new Section 3, before current Core Design)

The SECP paper's Definitions 1-7 are exemplary. Your paper currently jumps from Related Work to Core Design without formal grounding. Add:

- **Definition: Shared Context Graph** -- formalize the semantic graph G = (N, E) with node types (claim, goal, risk, contradiction), edge types, and monotonicity constraints
- **Definition: Governance Function** -- formalize governance as Pi: Proposals -> {Approve, Reject, Escalate}
- **Definition: Convergence** -- formalize V(t) with explicit conditions for convergence, stalling, and divergence
- **Definition: Finality** -- formalize the 5-gate conjunction as a predicate F(t) = Gate_A(t) AND Gate_B(t) AND ... AND Gate_E(t)

### 2.2 Explicit Caveats Section (new Section 9, before current Limitations)

Modeled on SECP Section 1.2's "What the paper does not demonstrate" -- currently absent from your paper. Add a **frank boundary statement**:

**What the paper demonstrates:**

- Architectural feasibility of declarative governance over shared state
- Formal convergence tracking with 5 gates prevents premature finality
- Perpetual lifecycle with certificate chains
- Three-tier governance routing with LLM-free fallback

**What the paper does NOT demonstrate:**

- Statistical validation of convergence under real LLM stochasticity (benchmarks are synthetic)
- Byzantine fault tolerance (agents assumed cooperative)
- Scalability beyond 50 claims / 5 documents / 7 agents
- Formal machine-checked proofs of convergence guarantees (empirical only)
- Multi-scope coordination or cross-scope finality
- Real human-in-the-loop validation (HITL is designed but not empirically tested)
- That Lyapunov convergence rate alpha is meaningful under discrete, sparse agent updates
- That the coverage-autonomy trade-off (SECP's key finding) is navigable through governance policy alone

### 2.3 Missing Formal Properties

- **Theorem sketch:** Under monotonic confidence, irreversible contradictions, and staling-not-deletion, V(t) is non-increasing when agents make progress. (Currently stated informally; needs at least a proof sketch.)
- **Complexity analysis:** Message complexity of the three-node cycle is O(n) per round (n = agents), total O(n * k) for k rounds. Compare to SECP's O(n^2) BFT constraint.
- **Termination guarantee:** The bounded round limit (Gate D quiescence + EXPIRED state) ensures termination. Formalize this.

---

## 3. Experiments to Run

These experiments directly address SECP's open questions and would produce results interesting to that community.

### Experiment 1: Convergence Dynamics (addresses SECP Section 8.6 item 1)

**Goal:** Demonstrate multi-iteration convergence behavior that SECP explicitly could not.

**Protocol:**

- Run 20 convergence cycles on the same scope with incremental context injection
- Measure V(t) trajectory, alpha(t) convergence rate, gate satisfaction per round
- Vary: number of contradictions per injection (0, 1, 3, 5)
- Report: convergence time (rounds to RESOLVED), V(t) monotonicity violations, oscillation frequency

**Expected interesting results:**

- V(t) trajectory shows characteristic shapes: exponential decay (easy), plateau-then-resolution (hard), oscillation-then-escalation (irreconcilable)
- The 50% coverage increase SECP observed in one iteration should map to a predictable V(t) drop in your framework

### Experiment 2: Scalability (addresses SECP Section 8.6 item 4)

**Goal:** First empirical data on how governed agent coordination scales.

**Protocol:**

- Vary claims: 10, 50, 100, 500, 1000
- Vary contradictions: 10%, 30%, 50% contradiction rate
- Vary agents: 3, 5, 7, 12 (your current 7 is the only data point)
- Fixed: governance mode (YOLO), finality thresholds
- Measure: rounds to convergence, wall-clock time, LLM token consumption, audit event count

**Expected interesting results:**

- Identify the scaling bottleneck (likely contradiction resolution, not claim extraction)
- Show whether convergence time grows linearly or super-linearly with contradiction count
- The pressure-directed activation should show its value at scale (agents concentrate on bottleneck dimension)

### Experiment 3: Finality Robustness (addresses SECP's convergence gap)

**Goal:** Demonstrate that the 5-gate mechanism prevents false finality under adversarial conditions.

**Protocol:**

- Inject "adversarial" evidence patterns designed to trigger premature finality:
  - Spike-and-drop: sudden high confidence followed by contradiction
  - Oscillating claims: alternating contradictory evidence
  - Stale evidence: evidence that exceeds max_age_days during convergence
  - Empty scope: trivial initialization
- Measure: false finality rate (RESOLVED when contradictions remain), gate trigger frequency, ESCALATED rate

**Expected interesting results:**

- Gate C (oscillation detection via lag-1 autocorrelation) should catch patterns that simple thresholds miss
- Gate B (evidence freshness) blocks finality on stale data -- novel contribution vs. SECP
- Trajectory quality score Q provides a richer signal than binary pass/fail

### Experiment 4: Governance Bounded -- Multi-Level (new contribution)

**Goal:** Demonstrate governance at multiple levels, extending both your and SECP's single-level models.

**Protocol:**

- Define 3 governance levels:
  - **Level 1 (Operational):** YOLO mode, per-agent activation filters
  - **Level 2 (Compliance):** MITL mode, drift-triggered rules
  - **Level 3 (Regulatory):** MASTER mode, immutable invariants
- Run the M&A scenario with cross-level interactions:
  - Financial claims escalate from L1 to L2 on contradiction
  - Patent disputes escalate from L2 to L3
  - L3 decisions are immutable (cannot be overridden by L1/L2)
- Measure: escalation frequency, decision distribution across levels, time-to-finality per level

**Expected interesting results:**

- Most decisions (>80%) resolved at L1 (deterministic), validating the three-tier architecture
- L3 decisions are rare but critical -- they block finality until human resolution
- The separation of duties is formally traceable through the certificate chain

### Experiment 5: Coverage-Autonomy Trade-off (directly engages SECP's central finding)

**Goal:** Empirically map the coverage-autonomy trade-off that SECP identified, using your governance modes as the control variable.

**Protocol:**

- Run identical document set through 3 governance modes: YOLO, MITL, MASTER
- Measure: claims accepted, contradictions resolved autonomously, human escalations, time to finality
- Map to SECP's framework: YOLO ~ scalar aggregation (high coverage), MASTER ~ hard veto (low coverage), MITL ~ SECP non-scalar (intermediate)

**Expected interesting results:**

- YOLO accepts more claims but with lower confidence floor (analogous to SECP's scalar aggregation accepting all 6 proposals)
- MASTER produces fewer but higher-quality decisions (analogous to SECP's Phase 1 veto)
- MITL navigates the middle ground -- and the Lyapunov convergence rate alpha should differ characteristically across modes

---

## 4. Structural Changes to the LaTeX Document

### Add these sections (in order):

1. **Section 3: Problem Setting** (new, before current Section 3 "Core Design")
   - Formal definitions (graph, governance, convergence, finality)
   - Explicit threat model (cooperative agents, no Byzantine faults)
   - Complexity bounds

2. **Section 4: Core Design** (current Section 3, renumbered)

3. **Section 9: Explicit Boundaries** (new, before current Limitations)
   - "What this paper demonstrates" / "What this paper does not demonstrate"
   - Comparison with SECP's claimed boundaries

4. **Section 10: Limitations and Future Work** (current Section 9, expanded)
   - Add: formal convergence proof gap (currently empirical only)
   - Add: coverage-autonomy trade-off is not formalized
   - Add: SECP-style protocol self-modification is not addressed (governance rules are static)
   - Add: the three-node cycle imposes a specific coordination topology that may not suit all domains

5. **References:** Add citation to SECP paper and the references from SECP that are relevant:
   - Lamport et al. 1982 (Byzantine generals)
   - Castro & Liskov 1999 (PBFT)
   - Ren et al. 2005 (MAS consensus survey)
   - Zheng et al. 2025 (CP-WBFT, confidence-weighted BFT)

### Modify these sections:

- **Related Work:** Add subsection on Self-Evolving Coordination Protocols citing SECP
- **Comparison Table:** Add nuance -- acknowledge that SECP's non-scalar coordination addresses coverage-autonomy in ways your system does not
- **Conclusion:** Position explicitly relative to SECP: "Where [SECP] demonstrates that bounded protocol self-modification is feasible, we demonstrate that formal convergence tracking provides the missing foundation for multi-iteration deployment of such mechanisms"

---

## 5. Key Files to Modify

- `swarm-governed-agents.tex` (this directory) -- main paper (all structural changes)
- `references.bib` (this directory) -- add SECP citation + ~5 new references from their bibliography
- `scripts/benchmark-convergence.ts` -- extend with new experiment scenarios
- Potentially new: `scripts/experiment-scalability.ts`, `scripts/experiment-governance-levels.ts`

---

## 6. Checklist (from original plan)

| Task | Status |
|------|--------|
| Add formal Problem Setting section | Done (Section 3) |
| Add "What this paper does/does not demonstrate" section | Done (Section 8 Scope and Boundaries) |
| Add SECP citation and Related Work subsection | Done (Section 2.2) |
| Add theorem sketch for V(t) monotonicity | Done (Theorem 1, Section 3.4) |
| Define Experiment 1: Convergence dynamics | Done (paper Section 9) |
| Define Experiment 2: Scalability | Done (paper Section 9) |
| Define Experiment 3: Finality robustness | Done (paper Section 9) |
| Define Experiment 4: Multi-level governance | Done (paper Section 9) |
| Define Experiment 5: Coverage-autonomy trade-off | Done (paper Section 9) |
| Reorganize LaTeX sections, update comparison, revise conclusion | Done |
| **Implement** Experiment 1-5 scripts | Pending (see GitHub issues) |
