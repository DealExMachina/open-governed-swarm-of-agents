# Formal Hardening: Per-Dimension Finality, Proof Obligations, and Assumption Validation

> Issue #18 implementation. Aligns finality semantics with the product lattice
> `M = L x A` by replacing scalar finality with a vector predicate, states
> assumptions explicitly, and defines proof obligations.

Back to [README.md](../README.md).

---

## Table of Contents

1. [Motivation](#1-motivation)
2. [Vector finality predicate](#2-vector-finality-predicate)
3. [Assumption matrix](#3-assumption-matrix)
4. [Proof obligations](#4-proof-obligations)
5. [Formal theorems](#5-formal-theorems)
6. [Implementation summary](#6-implementation-summary)
7. [Experiment program](#7-experiment-program)
8. [Roadmap to machine-checked proofs](#8-roadmap-to-machine-checked-proofs)
9. [References](#9-references)

---

## 1. Motivation

The governance admissibility check in the reduction kernel already operates
on the product lattice `M = L x A` (see `sgrs-core/src/types/mod.rs`).
Each approved transition must not regress any individual dimension—the
kernel rejects transitions that violate per-dimension monotonicity.

However, the finality evaluator's RESOLVED decision relied on a **scalar**
goal score:

```
goalScore = w_claim * claim_confidence + w_contra * contradiction_resolution
          + w_goal * goal_completion + w_risk * risk_score_inverse
```

compared against a single threshold (0.92). This creates a
**compensation artifact**: one dimension can over-improve to push the
scalar sum above threshold while another dimension (e.g.,
`contradiction_resolution`) remains unsafe.

**Example.** `claim=1.0, contra=0.80, goal=1.0, risk_inv=1.0`:
- Scalar: `0.30*1.0 + 0.30*0.80 + 0.25*1.0 + 0.15*1.0 = 0.94` → passes 0.92
- Vector: `contra=0.80 < threshold=0.95` → **BLOCKED**

This is the theory/evaluation mismatch that Issue #18 closes.

---

## 2. Vector Finality Predicate

### Definition

```
F*(t) = AND_d [ e_d(t) <= eps_d  AND  GA_d  AND  GC_d ]
        AND  GB  AND  GD  AND  GE
```

where:
- `e_d(t) = max(0, tau_d - mu_d(t))` is the per-dimension finality gap
- `tau_d` is the per-dimension threshold
- `eps_d` is the per-dimension epsilon tolerance
- `GA_d` is per-dimension monotonicity (non-decreasing for beta rounds)
- `GC_d` is per-dimension trajectory quality (no oscillation per dimension)
- `GB, GD, GE` are global gates (evidence, quiescence, content)

### Dimension Thresholds and Tolerances

| Dimension | Threshold (`tau_d`) | Epsilon (`eps_d`) | Veto |
|-----------|-------------------|------------------|------|
| claim_confidence | 0.85 | 0.02 | No |
| contradiction_resolution | 0.95 | 0.01 | **Yes** |
| goal_completion | 0.90 | 0.02 | No |
| risk_score_inverse | 0.80 | 0.03 | No |

**Veto semantics.** A veto dimension blocks finality unconditionally when
it fails, regardless of other dimensions. `contradiction_resolution` is
veto because unresolved contradictions represent epistemic uncertainty that
no amount of claim confidence or goal completion can compensate.

### Gate Architecture

| Gate | Scope | Description |
|------|-------|-------------|
| GA_d | Per-dimension | Score non-decreasing for beta=3 rounds |
| GC_d | Per-dimension | Trajectory quality >= 0.7 (no oscillation) |
| GB | Global | Evidence coverage and contradiction mass = 0 |
| GD | Global | Quiescence (idle cycles + risk check) |
| GE | Global | Minimum content (claims exist or goals incomplete) |

GA and GC moved from scalar to per-dimension. GB, GD, GE remain global
because they apply to the scope as a whole.

### Configuration

See `finality.yaml`:

```yaml
per_dimension_finality:
  enabled: true
  required_dimensions: [claim_confidence, contradiction_resolution, goal_completion, risk_score_inverse]
  dimension_thresholds:
    claim_confidence: 0.85
    contradiction_resolution: 0.95
    goal_completion: 0.90
    risk_score_inverse: 0.80
  veto_dimensions: [contradiction_resolution]
  epsilon:
    claim_confidence: 0.02
    contradiction_resolution: 0.01
    goal_completion: 0.02
    risk_score_inverse: 0.03
```

Setting `enabled: false` falls back to scalar finality (backward compatible).

---

## 3. Assumption Matrix

Seven assumptions underpin the formal claims. Each is classified by
validation status with evidence references.

| ID | Assumption | Formal Statement | Status | Evidence |
|----|-----------|------------------|--------|----------|
| A1 | Well-founded descent | `A` is discretized; dimension scores change by minimum step `delta_min > 0` | Empirically validated | Convergence instrumentation; Exp 6 |
| A2 | Kernel determinism | `evaluate_kernel(proposal, graph, rules, lattice)` is a pure function | Proven | Rust kernel is `pub fn` with no side effects; 141 Rust tests |
| A3 | Monotone CRDT evolution | `confidence(t+1) >= confidence(t)`; contradictions irreversible | Proven | SQL guard `confidence <= $2`; `factsToSemanticGraph.ts` CRDT invariants |
| A4 | Progress precondition | At least one dimension can improve when admissible resolutions exist | Empirically validated | Exp 6: resolver advances `goal_completion` |
| A5 | Local confluence boundary | Compatible transitions commute; stale-claim marking may not | Partially validated | Exp 9: 6 sub-tests, 24 permutations, 80 kernel evals |
| A6 | Non-compensability | Finality blocked if any required dimension fails threshold | **Implemented** | Vector finality predicate; 20 Rust + 13 TS tests |
| A7 | Tier completeness | Tier 3 reachable under realizable disagreement workloads | Partially validated | Exp 7: MITL escalation; Tier 3 (escalateToLLM) with OPENAI_API_KEY + OVERSEE_MODEL=gpt-4o + YOLO; see [exp7 Tier 3 checklist](experiments/exp7/README.md#tier-3-checklist) |

### Key Insight: Why Per-Dimension Finality is Sound

Each dimension has **inflationary CRDT updates** (A3):
- Confidence only increases (max-join ratchet)
- Contradictions are irreversibly resolved (set-once)
- Goals complete monotonically (no un-completion)
- Risk decreases as contradictions resolve

Once a dimension crosses its threshold within an epoch, it cannot regress.
This is stronger than naive per-coordinate consensus (Abbas et al. 2020)
and avoids the bounding-box problem: our dimensions don't converge
independently—they share a coordination mechanism (the reduction kernel)
that enforces joint monotonicity.

---

## 4. Proof Obligations

| ID | Obligation | Approach | Status |
|----|-----------|----------|--------|
| PO-1 | Epoch termination | Rank function `r(t) = sum_d max(0, tau_d - mu_d(t))` is non-negative and strictly decreasing under A1+A3+A4 | Formal sketch + empirical |
| PO-2 | Per-dimension finality soundness | Construct counterexample where scalar passes but vector blocks (compensation attack) | **Proven by test** |
| PO-3 | Eventual consistency safety | After complete re-extraction, state converges to canonical within bounded rounds | Empirical (Exp 9) |
| PO-4 | Routing completeness | Construct workloads forcing Tier 1/2/3 path diversity | Partial (Exp 7) |

### PO-2: Non-Compensability Proof

**Theorem (Vector Finality Soundness).** Under A3 and A6, if `F*(t) = true`
then for all required dimensions `d`: `mu_d(t) >= tau_d - eps_d`, `GA_d`
holds, and `GC_d` holds. No scalar-pass/vector-fail state is reachable
when `F*(t) = true`.

**Proof.** By definition of `F*`, each conjunct must hold. The converse
is the interesting direction: construct a state where scalar passes but
vector fails. The test `vector_finality_blocks_compensation` provides a
concrete witness:

```
scores = [1.0, 0.80, 1.0, 1.0]
scalar = 0.30*1.0 + 0.30*0.80 + 0.25*1.0 + 0.15*1.0 = 0.94 >= 0.92 ✓
vector: contra_resolution = 0.80 < threshold 0.95, gap = 0.15 > eps 0.01 ✗
```

Scalar declares RESOLVED; vector blocks it. The compensation is detected
and logged (`compensation_detected = true`).

---

## 5. Formal Theorems

### Theorem 1: Epoch Termination (Strengthened)

Under A1–A4, the rank function:

```
r(t) = sum_d max(0, tau_d - mu_d(t))
```

is a well-founded measure on `[0, sum_d tau_d]` that strictly decreases
at each evaluation cycle where at least one dimension makes progress
(A4). Since `A` is discretized (A1) with minimum step `delta_min > 0`,
the maximum number of evaluation cycles before `r(t) = 0` is bounded by:

```
K <= sum_d tau_d / delta_min
```

This strengthens the original Theorem 1 by using the per-dimension rank
function instead of the scalar `V(t)`, providing a tighter bound that
does not depend on weight normalization.

### Theorem 2: Vector Finality Soundness

Under A3 and A6:

1. `F*(t) = true` implies no dimension is below its threshold minus epsilon.
2. No scalar-pass/vector-fail state is reachable when `F*(t) = true`.
3. Any state where `goalScore >= autoThreshold` but some `mu_d(t) < tau_d - eps_d` is a compensation attack, detected by the `compensation_detected` flag.

### Lemma: CRDT Monotonicity

Under A3, for all dimensions `d` and within an evidence epoch:

```
mu_d(t+1) >= mu_d(t)
```

Proof: Each dimension's score is computed from monotonically non-decreasing
quantities (confidence ratchet, irreversible contradiction resolution,
monotonic goal completion, risk derived from non-increasing unresolved
count).

---

## 6. Implementation Summary

### Files Modified/Created

| File | Change |
|------|--------|
| `finality.yaml` | Added `per_dimension_finality` section |
| `src/finalityEvaluator.ts` | Added types, dual-mode Path A (vector/scalar) |
| `sgrs-core/src/finality/vector.rs` | **New**: vector finality predicate |
| `sgrs-core/src/finality/mod.rs` | Registered vector module |
| `sgrs-core/src/convergence/analyze.rs` | Per-dimension GA_d and GC_d |
| `sgrs-core/src/bridge.rs` | Vector finality DTOs and bridge function |
| `src/sgrsAdapter.ts` | `evaluateVectorFinality()` adapter |
| `src/convergenceTracker.ts` | Extended ConvergenceState type |
| `sgrs-core/src/finality/tests.rs` | 20 new Rust tests |
| `test/unit/vectorFinality.test.ts` | **New**: 13 TypeScript tests |

### Test Coverage

- **141 Rust tests** (up from 121): 20 new vector finality tests covering
  gap computation, epsilon tolerance, compensation detection, veto
  dimensions, per-dimension monotonicity, trajectory quality, global gates
- **319 TypeScript tests** (up from 306): 13 new tests covering config
  loading, integration with evaluateFinality, backward compatibility,
  certificate payload shape, type correctness

### Backward Compatibility

Setting `per_dimension_finality.enabled: false` in `finality.yaml` or
setting `FINALITY_GATES_DISABLED=1` produces identical behavior to the
pre-Issue-#18 scalar implementation. The scalar path is preserved as
the `else` branch in Path A of `evaluateFinality()`.

---

## 7. Experiment Program

Five experiments are planned to validate the formal claims:

| ID | Name | Purpose | Key Metrics |
|----|------|---------|-------------|
| E1 | Scalar vs Vector Finality | Compare false finality rate | `false_finality_rate`, `blocked_compensation_cases` |
| E2 | Tier-3 Reachability | Force LLM disagreement | tier coverage, disagreement matrix |
| E3 | Discretization Sweep | Vary epsilon per dimension | termination failures, cycles-to-finality |
| E4 | Confluence Boundary | Extend Exp 9 with vector finality | divergence window, recovery rounds |
| E5 | Adversarial Compensation Attack | Attack one dimension while inflating others | compensation attacks blocked (scalar vs vector) |

E5 is the key falsification experiment for PO-2.

---

## 8. Roadmap to Machine-Checked Proofs

The formal theorems above are proof sketches. A machine-checked
formalization would require:

1. **Lean 4**: Encode the product lattice `M = L x A`, the monotonicity
   invariants (A3), and the rank function `r(t)`. Prove Theorem 1 using
   the Metatheory library for well-founded induction.

2. **TLA+**: Specify the reduction kernel as a state machine with
   safety invariants: (a) no RESOLVED state reachable with
   `mu_d < tau_d - eps_d` for any required dimension; (b) monotonicity
   preserved across all governance-approved transitions.

3. **Coq/Iris**: For the CRDT monotonicity lemma, using Iris's resource
   algebra framework to model inflationary updates.

This is a separate issue from the implementation work. The proof sketches
and empirical validation provide confidence in the claims while
machine-checked proofs are developed.

---

## 9. References

Verified references with DOIs or URLs where available. Short summaries support traceability to the formal-hardening narrative (lattices, confluence, finality, CALM, CRDTs).

---

**Resilient multi-dimensional consensus**

- Yan, J., Li, X., Mo, Y., & Wen, C. (2022). Resilient multi-dimensional consensus in adversarial environment. *Automatica*, 145. doi:[10.1016/j.automatica.2022.110530](https://doi.org/10.1016/j.automatica.2022.110530)  
  *Summary:* Algorithms for consensus when some agents are faulty or adversarial; benign agents reach agreement inside the convex hull of initial states. Uses sorting and “middle points” per dimension. Relevant to robust convergence under Byzantine-like failures. (Note: An “Abbas et al. 2020” Automatica reference was not uniquely identified; this is the closest verified match.)

**Blockchain finality**

- Anceaume, E., Del Pozzo, A., Rieutord, T., & Tucci-Piergiovanni, S. (2021). On finality in blockchains. In *Proc. OPODIS 2021* (LIPIcs, Vol. 217). Schloss Dagstuhl. doi:[10.4230/LIPIcs.OPODIS.2021.6](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.OPODIS.2021.6)  
  *Summary:* Formalizes finality (deterministic vs probabilistic, immediate vs eventual), bounded revocation, and reductions between finality and consensus. Connects blockchain design to classical distributed agreement; relevant to certifying “no rollback” in our setting.

**Term rewriting and termination**

- Baader, F., & Nipkow, T. (1998). *Term Rewriting and All That*. Cambridge University Press. ISBN 978-0521779203.  
  *Summary:* Standard reference for rewrite systems, termination, and confluence. Used for well-founded descent and reduction semantics.

**Logic, lattices, and distributed programming (CALM)**

- Conway, N., Marczak, W. R., Alvaro, P., Hellerstein, J. M., & Maier, D. (2012). Logic and lattices for distributed programming. In *Proc. SoCC 2012*. ACM. doi:[10.1145/2391229.2391230](https://dl.acm.org/doi/10.1145/2391229.2391230)  
  *Summary:* Bloom^L: logic programming plus lattice-based data; CALM (consistency as logical monotonicity) and automatic verification of coordination-free consistency. Direct precursor to CALM theorem and lattice-based coordination.

- Hellerstein, J. M., & Alvaro, P. (2019). Keeping CALM: when distributed consistency is easy. *arXiv* [cs.DC] 1901.01930. [arXiv:1901.01930](https://arxiv.org/abs/1901.01930)  
  *Summary:* CALM theorem: programs achieve distributed consistency without coordination iff they are expressible in monotonic logic. Constructive counterpart to CAP; guides when coordination is necessary.

**Self-evolving coordination**

- de la Chica Rodriguez, J. M., & Vera Díaz, J. M. (2026). Self-evolving coordination protocol in multi-agent AI systems: an exploratory systems feasibility study. *arXiv* 2602.02170. [arXiv:2602.02170](https://arxiv.org/abs/2602.02170)  
  *Summary:* SECP: coordination protocols with bounded, auditable self-modification under fixed invariants. Aligns with our formal boundaries and coverage–autonomy trade-off.

**Confluence (non-terminating / generalized Newman)**

- Ivanov, I. (2023). Generalized Newman’s lemma for discrete and continuous systems. In *Proc. FSCD 2023* (LIPIcs, Vol. 260). Schloss Dagstuhl. doi:[10.4230/LIPIcs.FSCD.2023.9](https://doi.org/10.4230/LIPIcs.FSCD.2023.9)  
  *Summary:* Confluence criterion for not-necessarily-terminating abstract rewrite systems; classical Newman’s lemma as a corollary. Formalized in Isabelle/HOL. Relevant to partial confluence and non-terminating dynamics.

**Modal logic and fixed points**

- Kozen, D. (1983). Results on the propositional mu-calculus. *Theoretical Computer Science*, 27(3), 333–354. doi:[10.1016/0304-3975(82)90125-6](https://doi.org/10.1016/0304-3975(82)90125-6)  
  *Summary:* Propositional mu-calculus; used for fixed-point reasoning in reduction semantics.

- Newman, M. H. A. (1942). On theories with a combinatorial definition of “equivalence”. *Annals of Mathematics*, 43(2), 223–243. doi:[10.2307/1968867](https://doi.org/10.2307/1968867)  
  *Summary:* Newman’s lemma: local confluence + termination imply global confluence. Basis for our partial-confluence discussion.

**Consensus and Lyapunov**

- Olfati-Saber, R., & Murray, R. M. (2004). Consensus problems in networks of agents with switching topology and time-delays. *IEEE Transactions on Automatic Control*, 49(9), 1520–1533. doi:[10.1109/TAC.2004.834113](https://doi.org/10.1109/TAC.2004.834113)  
  *Summary:* Lyapunov-based consensus; monotonically decreasing disagreement functions and convergence. Foundation for our V(t) and finality gates.

**CRDTs**

- Shapiro, M., Preguiça, N., Baquero, C., & Zawirski, M. (2011). Conflict-free replicated data types. In *Proc. SSS 2011* (LNCS 6976). Springer. doi:[10.1007/978-3-642-24550-3_29](https://doi.org/10.1007/978-3-642-24550-3_29)  
  *Summary:* CRDTs and strong eventual consistency; state- and operation-based CRDTs, monotonicity and commutativity. Foundational for our semantic graph and monotonic guarantees.

**Lattice fixpoints**

- Tarski, A. (1955). A lattice-theoretical fixpoint theorem and its applications. *Pacific Journal of Mathematics*, 5(2), 285–309. [msp.org/pjm/1955/5-2](https://msp.org/pjm/1955/5-2/p11.xhtml)  
  *Summary:* Fixed points of monotone functions on complete lattices form a complete lattice (least and greatest fixpoints). Used for well-founded ordering and product lattice.
