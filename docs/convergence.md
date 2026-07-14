# Convergence Theory and Configuration

> Lattice-geometric finality for governed agent swarms: two convergence layers, one admissibility order.

Back to [README.md](../README.md). This page documents the convergence mechanisms and configuration used by the open snapshot.

---

## Table of contents

0. [Two-layer convergence model](#0-two-layer-convergence-model)
1. [Problem statement](#1-problem-statement)
2. [Semantic-layer diagnostics](#2-semantic-layer-diagnostics)
3. [Integration with finality evaluator](#3-integration-with-finality-evaluator)
4. [Configuration reference](#4-configuration-reference)
5. [Monotonic graph upserts](#5-monotonic-graph-upserts)
6. [Benchmark scenarios](#6-benchmark-scenarios)
7. [Propagation layer: sheaf Dirichlet energy and global sections](#7-propagation-layer-sheaf-dirichlet-energy-and-global-sections)
8. [Dual-condition finality (the ∧-gate)](#8-dual-condition-finality-the-gate)
9. [References](#9-references)

---

## 0. Two-layer convergence model

Finality in this system is a statement about a **lattice**, not a scalar threshold. Two orthogonal layers must each reach the bottom of their respective order before a scope is RESOLVED:

| | Semantic layer | Propagation layer |
|---|---|---|
| State | dimension score vector `μ(t) ∈ [0,1]⁴` | evidence state `x ∈ ℝ^{2D·N}` (support/refutation per role per dimension) |
| Order | convergence-rank lattice `M = L × A` (meet/join on the dimension vector) | bilattice stalks over the role graph, coupled by a cellular sheaf |
| Admissibility test | vector finality `F*(t)`: the finality gap vector `(τ − μ)⁺` is zero on every required dimension (non-compensable) | global section: the sheaf Dirichlet energy `f(x) = xᵀL_F x = ‖δx‖²` is below `ε_prop` |
| "Done" means | every governance dimension independently meets its threshold | all connected roles agree on their shared observations |
| Lyapunov certificate | `V(t) = Σ w_d (τ_d − μ_d)²` — a **diagnostic** scalar, not the admissibility test | `f(x)` — the **true** Lyapunov function for the diffusion dynamics, contracts at rate `(1 − αλ₂)²` |

The two are independent. `V(t)` and its derived signals (rate, ETA, plateau, pressure) are monitoring instruments that describe *how* the semantic layer is moving; admissibility itself is the vector predicate `F*`. Replacing `F*` with "minimise `V`" would re-expose the compensation attack, where a strong dimension hides a weak one behind a favourable weighted average. See [section 2](#2-semantic-layer-diagnostics) for the diagnostics, [section 7](#7-propagation-layer-sheaf-dirichlet-energy-and-global-sections) for the propagation layer, and [section 8](#8-dual-condition-finality-the-gate) for how the two combine into RESOLVED.

---

## 1. Problem statement

The original `evaluateFinality()` was **memoryless**: each invocation computed a fresh goal score from a snapshot and checked it against a threshold. This design suffers from four failure modes that are well-documented in distributed systems and multi-agent coordination literature:

**Transient spikes.** A single evaluation cycle where all dimensions happen to align (e.g., a batch of claims arrives with high confidence) can push the goal score above the auto-finality threshold. The system declares RESOLVED. On the next cycle, the score drops back below threshold -- but the case is already closed. Memoryless evaluation has no mechanism to distinguish a genuine steady state from a transient spike.

**Oscillation.** Agents working in parallel can create alternating improvement and regression. The facts agent raises claim confidence; the drift agent detects a contradiction that lowers the contradiction resolution score. The system oscillates around a value without ever converging. A threshold check sees each snapshot in isolation and cannot detect the pattern.

**Stagnation.** The system reaches a plateau at, say, 0.70. All dimensions are partially satisfied but no agent is making progress. Without memory of previous scores, the evaluator cannot detect that nothing has changed. Agents continue cycling, consuming resources, producing no value. There is no trigger for human intervention.

**No ETA.** Even when the system is converging, a memoryless evaluator cannot estimate how many more cycles are needed. Operators have no visibility into whether finality is minutes or hours away, making resource allocation and scheduling impossible.

The convergence tracker (`src/convergenceTracker.ts`) transforms finality from a memoryless threshold check into a **stateful process** with formal convergence guarantees. It maintains a history of evaluation points and applies five mechanisms from the research literature to detect convergence, divergence, plateau, and bottleneck dimensions.

---

## 2. Semantic-layer diagnostics

> These five mechanisms are **diagnostics** on the semantic layer. They decide routing (RESOLVED vs HITL vs ESCALATED) and explainability, but admissibility for RESOLVED is the vector finality predicate `F*` (see [section 8](#8-dual-condition-finality-the-gate)), not the scalar `V(t)`. `V(t)` is retained because a scalar Lyapunov certificate with a convergence rate and ETA is operationally useful — it tells operators whether the semantic layer is converging, stalled, or diverging.

```mermaid
flowchart LR
  subgraph inputs["Inputs"]
    S[Snapshot]
    H[History]
  end
  subgraph mech["Mechanisms"]
    V[V Lyapunov]
    ALPHA[Convergence rate alpha]
    MONO[Monotonicity gate]
    PLAT[Plateau detection]
    PRESS[Pressure-directed]
  end
  S --> V & ALPHA & PRESS
  H --> ALPHA & MONO & PLAT
  V --> ALPHA
```

### 2.1 Lyapunov disagreement function V(t)

**Definition.** A scalar non-negative function that measures the aggregate weighted distance of all finality dimensions from their targets. V = 0 means perfect finality; V > 0 means at least one dimension is below target.

**Formula.**

```
V(t) = sum over d of ( w_d * (target_d - actual_d)^2 )
```

where:
- `d` ranges over four dimensions: `claim_confidence`, `contradiction_resolution`, `goal_completion`, `risk_score_inverse`
- `w_d` is the weight for dimension `d` (default: 0.30, 0.30, 0.25, 0.15)
- `target_d` is the target value for dimension `d` (default: 1.0 for all dimensions)
- `actual_d` is the current normalized score for dimension `d` in [0, 1]

**Properties.**
- V(t) >= 0 for all t (non-negative by construction).
- V(t) = 0 if and only if all dimensions are at their targets.
- If V(t) is strictly decreasing over time, the system is asymptotically converging toward finality.
- The quadratic form penalizes large gaps more heavily than small ones, creating a natural gradient toward the worst-performing dimension.

**Dimension score computation.** Each dimension is normalized to [0, 1]:
- `claim_confidence` = min(avg_confidence / 0.85, 1)
- `contradiction_resolution` = 1 - (unresolved / total), or 1 if no contradictions exist
- `goal_completion` = goals_completion_ratio
- `risk_score_inverse` = 1 - min(scope_risk_score, 1)

**Literature.** Olfati-Saber & Murray (2004) introduced Lyapunov-based analysis for multi-agent consensus, proving that if a common Lyapunov function decreases monotonically, the system converges to agreement. We adapt this by treating finality dimensions as "agents" that must agree with their targets.

### 2.2 Convergence rate and ETA

**Definition.** The exponential decay rate of V(t), averaged over recent transitions. Positive alpha means V is decreasing (converging); negative alpha means V is increasing (diverging); alpha near zero means stalled.

**Formula.**

```
alpha = -ln( V(t) / V(t-1) )
```

averaged over the most recent min(|history|, 5) consecutive pairs. The implementation clamps the ratio to avoid log(0) when V reaches zero.

**ETA estimation.** Given the current V(t) and a target epsilon (default 0.005), the estimated rounds to finality is:

```
ETA = ceil( -ln(epsilon / V(t)) / alpha )
```

This assumes exponential decay continues at the current rate. The estimate is capped at 1000 rounds; values above this return null (unreliable). If V(t) is already below epsilon, ETA = 0.

**Properties.**
- Alpha > 0: system is converging; ETA is finite and meaningful.
- Alpha < 0: system is diverging; ETA is null. If alpha < divergence_rate (default -0.05), the evaluator triggers ESCALATED.
- Alpha near 0: system is stalled; ETA is null. Plateau detection (section 2.4) handles this case.

**Implementation note.** The rate is averaged over up to 5 recent pairs rather than computed from a single pair. This smooths out noise from individual transitions while remaining responsive to trend changes.

### 2.3 Monotonicity gate

**Definition.** The goal score must be non-decreasing for beta consecutive rounds before the system is eligible for automatic resolution. This prevents premature finality from transient spikes.

**Formula.** Let `s(t)` be the goal score at round t. The monotonicity predicate is:

```
is_monotonic = for all i in [t - beta + 1, t]:  s(i) >= s(i-1) - epsilon
```

where epsilon = 0.001 (tolerance for floating-point noise). The default beta is 3 rounds.

**Properties.**
- The gate is a necessary condition for auto-RESOLVED, not a sufficient one. All hard conditions (claims, contradictions, goals, risk) must also hold.
- A single drop of more than 0.001 in any of the last beta rounds resets the gate.
- The gate requires at least beta data points; with fewer, `is_monotonic` is false.
- This is a purely local property: it only examines the last beta rounds, not the entire history.

**Literature.** Ruan et al. (2025) introduce the Aegean consensus protocol for multi-agent reasoning, with incremental quorum convergence and provable refinement monotonicity. The monotonicity gate adapts their requirement that solution quality is non-decreasing---applied here to the goal score rather than a replicated log.

### 2.4 Plateau detection

**Definition.** The system is considered plateaued when the exponential moving average (EMA) of the progress ratio stays below a threshold for tau consecutive rounds. A plateau triggers human-in-the-loop review because the system is no longer making meaningful progress.

**Formula.** At each round t, the progress ratio is:

```
progress_ratio(t) = max(0, s(t) - s(t-1)) / max(auto_threshold - s(t), 0.001)
```

The EMA is updated as:

```
EMA(t) = ema_alpha * progress_ratio(t) + (1 - ema_alpha) * EMA(t-1)
```

with `ema_alpha` = 0.3 (default). The plateau predicate is:

```
is_plateaued = (consecutive rounds where EMA < plateau_threshold) >= tau
```

with `plateau_threshold` = 0.01 and `tau` = 3 (defaults).

**Properties.**
- The progress ratio measures improvement relative to the remaining gap, not absolute improvement. A delta of 0.01 at score 0.90 (gap 0.02) counts more than a delta of 0.01 at score 0.50 (gap 0.42).
- Negative deltas are clamped to 0 in the numerator. Regression does not cancel out previous plateau rounds.
- The EMA provides smoothing: a single good round does not instantly clear a plateau.
- During divergence, progress ratio is 0 (deltas are negative, clamped to 0), so plateau is also detected. This is correct: the system is both diverging and stalled. The divergence rate (alpha < -0.05) is the primary signal; plateau is secondary.

**Literature.** Camacho et al. (2024) describe EMA-based stagnation detection in their MACI framework for multi-agent collective intelligence. The progress ratio formulation adapts their approach to the finality gradient domain.

### 2.5 Pressure-directed activation

**Definition.** Per-dimension pressure quantifies how far each dimension is from its target, weighted by importance. The dimension with the highest pressure is the current bottleneck. This information is used for stigmergic agent routing: agents activate preferentially on the dimension that most needs attention.

**Formula.**

```
pressure_d = w_d * max(0, 1 - actual_d)
```

for each dimension d. The highest-pressure dimension is:

```
highest_pressure_dimension = argmax_d( pressure_d )
```

**Properties.**
- Pressure is always non-negative.
- A dimension at target (actual_d = 1) has zero pressure.
- The weight scaling ensures that pressure reflects both the gap and the dimension's importance in the goal score.
- When multiple dimensions have equal pressure, the first one encountered is reported (implementation detail, not semantically meaningful).

**Literature.** Dorigo, Theraulaz, & Trianni (2024) survey stigmergic coordination in swarm intelligence, where agents respond to environmental signals (pheromones, gradients) rather than explicit messages. Pressure-directed activation adapts this principle: the convergence state is the "pheromone map" and agents activate where pressure is highest.

### 2.6 Gate C: Oscillation detection and trajectory quality

**Definition.** Beyond monotonicity and plateau, the system detects **oscillation** (repeated direction changes in goal score or negative lag-1 autocorrelation) and computes a **trajectory quality** score in [0, 1]. Auto-RESOLVED additionally requires trajectory_quality >= 0.7 so that transient spikes or oscillating paths do not trigger resolution.

**Oscillation.** Implemented via: (1) counting direction changes in the last N goal scores (two or more imply oscillation), and (2) lag-1 autocorrelation of the score series (below -0.3 implies oscillation). When either condition holds, `oscillation_detected` is true.

**Trajectory quality.** Starts at 1; reduced by direction-change penalty and by a cap when oscillation (autocorrelation) is detected; further reduced when the latest score is well below the recent maximum (spike-and-drop). Used in the finality evaluator as a Gate C condition alongside monotonicity.

**Coordination signal.** The convergence state exposes a minimal `coordination_signal` (signal_type, value, metadata) with highest_pressure_dimension, trajectory_quality, and oscillation_detected for downstream agents or explainability.

---

## 3. Integration with finality evaluator

The `evaluateFinality(scopeId)` function in `src/finalityEvaluator.ts` runs as a six-step workflow after each governance cycle. The convergence tracker is integrated at steps 3 and 4.

### 3.1 Workflow steps

```mermaid
flowchart LR
  S1[1. Prior human decision?] --> S2[2. Load snapshot]
  S2 --> S3[3. Compute V, pressure; record point]
  S3 --> S4[4. Load history; analyze rate, monotonicity, plateau]
  S4 --> S5[5. Evaluate conditions & score]
  S5 --> S6[6. Route: RESOLVED / ESCALATED / HITL / ACTIVE]
```

| Step | Action | Source |
|------|--------|--------|
| 1 | Check for prior human-approved finality decision | `finalityDecisions.ts` |
| 2 | Load finality snapshot from semantic graph | `semanticGraph.ts` |
| 3 | Compute Lyapunov V, pressure, dimension scores; record convergence point to DB | `convergenceTracker.ts` |
| 4 | Load convergence history and analyze state (rate, monotonicity, plateau) | `convergenceTracker.ts` |
| 5 | Evaluate finality conditions and goal score against thresholds | `finalityEvaluator.ts` |
| 6 | Route to appropriate outcome (RESOLVED, ESCALATED, HITL review, or ACTIVE) | `finalityEvaluator.ts` |

If the convergence tracker is unavailable (e.g., the `convergence_history` table does not exist), the evaluator degrades gracefully: the monotonicity gate defaults to true (permissive) and convergence data is omitted from the HITL review payload.

### 3.2 Decision path

```mermaid
flowchart TD
  A[evaluateFinality] --> B{Prior approve_finality?}
  B -->|yes| R1[RESOLVED]
  B -->|no| C{All conditions + score >= 0.92 + monotonic?}
  C -->|yes| R1
  C -->|no| D{alpha < -0.05?}
  D -->|yes| E1[ESCALATED]
  D -->|no| F{Score in 0.40..0.92?}
  F -->|yes| G{Plateau?}
  G --> HITL[HITL review]
  F -->|no| I{ESCALATED / BLOCKED / EXPIRED conditions?}
  I -->|yes| E1
  I -->|no| ACT[ACTIVE]
```

### 3.3 Decision path table

| Condition | Convergence state | Outcome |
|-----------|-------------------|---------|
| Human previously approved finality | Any | RESOLVED |
| All RESOLVED conditions met, score >= auto (0.92), monotonicity gate satisfied | is_monotonic = true | RESOLVED |
| All RESOLVED conditions met, score >= auto (0.92), monotonicity gate not satisfied | is_monotonic = false | Remains ACTIVE (gate blocks premature finality) |
| Convergence rate alpha < divergence_rate (-0.05), history >= 3 points | Diverging | ESCALATED |
| Score in [near (0.40), auto (0.92)), plateau detected | is_plateaued = true | HITL review (with convergence context) |
| Score in [near (0.40), auto (0.92)), not plateaued | is_plateaued = false | HITL review (standard) |
| ESCALATED conditions met (risk >= 0.75, contradictions >= 3, etc.) | Any | ESCALATED |
| BLOCKED conditions met (idle >= 5, stale >= 300s, contradictions >= 1) | Any | BLOCKED |
| EXPIRED conditions met (inactive >= 30 days) | Any | EXPIRED |
| None of the above | Any | ACTIVE (keep iterating) |

### 3.4 HITL review payload

When the score is in the near-finality range, a `FinalityReviewRequest` is constructed with:
- Goal score, threshold values, and gap
- Per-dimension breakdown with scores, weights, and status (ok/partial/blocking)
- List of specific blockers (unresolved contradictions, critical risks, low confidence, missing goals)
- Convergence data: rate, ETA, Lyapunov V, plateau status, highest-pressure dimension, score history
- LLM-generated explanation (via Ollama, if available)
- Suggested actions derived from blockers
- Four action options: approve finality, provide resolution, escalate, defer (7 days)

The convergence section of the HITL prompt enables the LLM to assess whether the system is making progress, whether waiting for more cycles is reasonable, or whether human intervention is needed now.

---

## 4. Configuration reference

All configuration lives in `finality.yaml` at the repository root.

### 4.1 Goal gradient weights

```yaml
goal_gradient:
  weights:
    claim_confidence: 0.30
    contradiction_resolution: 0.30
    goal_completion: 0.25
    risk_score_inverse: 0.15
  near_finality_threshold: 0.40
  auto_finality_threshold: 0.92
```

| Parameter | Default | Description | Tuning guidance |
|-----------|---------|-------------|-----------------|
| `weights.claim_confidence` | 0.30 | Weight for claim confidence dimension | Increase for domains where evidence quality is critical (e.g., scientific review) |
| `weights.contradiction_resolution` | 0.30 | Weight for contradiction resolution dimension | Increase for adversarial or multi-source domains (e.g., due diligence) |
| `weights.goal_completion` | 0.25 | Weight for goal completion dimension | Increase for task-oriented workflows with explicit deliverables |
| `weights.risk_score_inverse` | 0.15 | Weight for inverse risk score dimension | Increase for safety-critical domains; decrease for exploratory analysis |
| `near_finality_threshold` | 0.40 | Goal score at which HITL review becomes eligible | Lower to catch cases earlier; raise to reduce review noise |
| `auto_finality_threshold` | 0.92 | Goal score at which auto-RESOLVED is possible (if all conditions met) | Lower only if false negatives are more costly than false positives |

Weights must sum to 1.0. The Lyapunov function, pressure computation, and goal score all use these same weights.

### 4.2 Convergence parameters

```yaml
convergence:
  beta: 3
  tau: 3
  ema_alpha: 0.3
  plateau_threshold: 0.01
  history_depth: 20
  divergence_rate: -0.05
```

| Parameter | Default | Description | Tuning guidance |
|-----------|---------|-------------|-----------------|
| `beta` | 3 | Monotonicity window: require score non-decreasing for this many rounds before auto-resolve | Increase for higher safety (more rounds of stability required); decrease for faster finality |
| `tau` | 3 | Plateau detection window: consecutive rounds below progress threshold to declare plateau | Increase to tolerate longer stalls before triggering HITL; decrease for earlier intervention |
| `ema_alpha` | 0.3 | EMA smoothing factor for progress ratio (0 = no smoothing, 1 = no memory) | Lower values make plateau detection slower to trigger but more robust to noise |
| `plateau_threshold` | 0.01 | Progress ratio below which a round counts as plateaued | Raise to be more aggressive about detecting stalls; lower to tolerate slower progress |
| `history_depth` | 20 | Number of convergence points to load from the database for analysis | Increase for longer-running scopes; keep low for fast scopes to reduce query cost |
| `divergence_rate` | -0.05 | Convergence rate alpha below which the system triggers ESCALATED | Make more negative to tolerate brief regressions; make less negative for stricter divergence detection |

### 4.3 Finality condition rules

```yaml
finality:
  RESOLVED:
    mode: all
    conditions:
      - claims.active.min_confidence: 0.85
      - contradictions.unresolved_count: 0
      - risks.critical.active_count: 0
      - goals.completion_ratio: ">= 0.90"
      - scope.risk_score: "< 0.20"
```

These are the hard conditions that must be satisfied (in addition to the goal score threshold and monotonicity gate) for automatic resolution. The `mode: all` means every condition must hold. Conditions support operators `>=`, `<=`, `>`, `<`, `==`.

The full set of recognized condition keys:
- `claims.active.min_confidence` -- minimum confidence among active claims
- `contradictions.unresolved_count` -- number of unresolved contradictions (target: 0)
- `risks.critical.active_count` -- number of active critical risks (target: 0)
- `goals.completion_ratio` -- ratio of resolved goals to total goals
- `scope.risk_score` -- aggregate risk score for the scope
- `scope.idle_cycles` -- number of cycles with no state change
- `scope.last_delta_age_ms` -- milliseconds since last state delta
- `scope.last_active_age_ms` -- milliseconds since last activity
- `assessments.critical_unaddressed_count` -- unaddressed critical assessments

---

## 5. Monotonic graph upserts

The monotonicity gate (section 2.3) requires that the goal score does not decrease between consecutive rounds. This requirement propagates a constraint onto the semantic graph: **state changes must not cause the goal score to regress**.

The semantic graph sync uses CRDT-inspired monotonic upserts to satisfy this constraint:

- **Claim confidence only increases.** When a claim is re-extracted with a higher confidence, the node is updated. When re-extracted with a lower confidence, the existing value is retained. This ensures the `claim_confidence` dimension score is a ratchet.
- **Resolution edges are irreversible.** Once a contradiction is marked resolved, the resolution edge cannot be deleted. This ensures the `contradiction_resolution` dimension score does not decrease.
- **Goal completion is additive.** Goal resolution records are appended, never removed. The `goal_completion` ratio can only increase.
- **Stale nodes are marked irrelevant, not deleted.** Removing a node could lower a dimension score (e.g., removing a high-confidence claim lowers the average). Instead, nodes are flagged and excluded from future aggregation, preserving the current aggregate.

**Why this matters for the monotonicity gate.** If graph updates could cause score regression, the monotonicity gate would trigger false negatives: the system might be genuinely converging but a graph update causes a brief dip, resetting the beta-round counter. Monotonic upserts ensure that any score decrease reflects a genuine change in the underlying domain (e.g., new contradictory evidence), not a bookkeeping artifact.

This design follows the CRDT principle that merge operations must be commutative, associative, and idempotent. Laddad et al. (2024) formalize this for collaborative editing; we apply it to semantic graph operations where the "merge" is a finality-aware upsert.

---

## 6. Benchmark scenarios

The benchmark harness (`scripts/benchmark-convergence.ts`) runs eleven pure-math scenarios with no external dependencies (no Docker, no Postgres, no NATS, no LLM). Each scenario generates a sequence of `FinalitySnapshot` values, converts them to `ConvergencePoint` records, and runs `analyzeConvergence()` to verify the outcome. Scenarios 1–7 cover core convergence mechanics; scenarios A–D (8–11) verify additional order and monotonicity properties of M = L × A added in the v2 retrofit.

Run with:

```bash
pnpm tsx scripts/benchmark-convergence.ts
# Multi-run consistency: run each scenario N times and assert identical outcomes
pnpm tsx scripts/benchmark-convergence.ts --runs=5
```

With `--runs=N` (N ≥ 2), each of the eleven scenarios is executed N times. The harness compares outcomes (pass/fail, convergence_rate, is_plateaued, is_monotonic, trajectory_quality, etc.). If any run differs from the first, the run fails and reports which scenario and which field differed. Use this to verify determinism and regression-proof the tracker.

| # | Scenario | Description | Expected outcome | What it validates |
|---|----------|-------------|------------------|-------------------|
| 1 | Steady convergence | All dimensions improve by ~5% per round over 15 rounds | Converging, monotonic, no plateau, ETA near 0 | V(t) decreases monotonically; monotonicity gate passes; no false plateau during fast improvement |
| 2 | Plateau at 0.70 | Score oscillates around 0.70 with +/- 0.002 jitter for 10 rounds | Not converging, plateaued, not monotonic | EMA-based plateau detection triggers after tau rounds of negligible progress |
| 3 | Spike-and-drop | Score rises to 0.95 then drops to 0.70 | Positive average rate (3/4 transitions improve), not monotonic, has ETA | Monotonicity gate blocks premature finality despite positive convergence rate; demonstrates why the gate is necessary |
| 4 | Divergence | Contradictions increase each round; all dimensions worsen over 6 rounds | Diverging (alpha < 0), plateaued (progress clamped to 0), not monotonic | Negative convergence rate detection; plateau co-occurs with divergence (correct: zero forward progress) |
| 5 | One-dimension bottleneck | 3 dimensions at target; contradiction_resolution stuck at 0.25 for 5 rounds | Not converging, plateaued, monotonic (constant score), highest pressure = contradiction_resolution | Pressure-directed activation correctly identifies the blocking dimension |
| 6 | Fast convergence | Reaches 0.92+ in 3 rounds with large jumps | Converging, monotonic, no plateau | No false plateau during rapid convergence; system correctly reports near-zero or zero ETA |
| 7 | Empty graph | No claims, no goals, score = 0.15 (only risk_inverse contributes) | Not converging, not plateaued, not monotonic | Safe defaults with single data point; no division by zero; no crashes on degenerate input |
| A | Governance escalation | V measured at Yolo, Mitl, Master governance stages with improving rank | V non-increasing across stages | Governance order and convergence order are aligned; escalation descends V |
| B | Conservative merger | meet(rankA, rankB) vs join(rankA, rankB) for incomparable agents | V(meet) ≥ V(join) | Conservative kernel decision (meet) carries more remaining work; safe choice is explicit |
| C | Contradiction resolution | Pre: 3/4 contradictions unresolved; post: 0 unresolved | V decreases; contradiction_resolution pressure drops | Resolving contradictions ascends the convergence order and descends V |
| D | Anti-compensation | Veto dim (contradiction_resolution) stuck at 0.50; non-veto dims at 1.0 | V non-zero; improving non-veto dims does not reduce V to zero | Vector finality blocks what scalar finality permits; no dimension can compensate for veto deficit |

Each scenario validates a specific failure mode or edge case. Scenarios 1–7 cover the five core mechanisms: V(t) computation, convergence rate, monotonicity gate, plateau detection, and pressure identification. Scenarios A–D verify that M = L × A is a distributive lattice carrying a norm-monotone V on its rank factor, and that agent routing toward high-pressure dimensions equals steepest V-descent.

---

## 7. Propagation layer: sheaf Dirichlet energy and global sections

The semantic layer answers "do the aggregate scores meet their targets?" The propagation layer answers a different, orthogonal question: "do the roles actually agree?" Ten reasoning roles each hold an evidence vector (support and refutation per dimension). They are coupled on a **cellular sheaf** over the role graph, and at each cycle the propagation agent runs one diffusion step

```
x_{t+1} = Π_A[(I − αL_F) x_t + ε_t]
```

where `L_F = δᵀδ` is the sheaf Laplacian, `δ` is the coboundary built from per-edge restriction maps (which encode *which dimensions each role observes*), and `Π_A` projects back onto the admissible box.

### 7.1 The right convergence quantity

The exact Lyapunov function for this dynamics is the **sheaf Dirichlet energy**

```
f(x) = xᵀ L_F x = ‖δx‖² = Σ_edges ‖δ_e x‖²
```

It contracts at rate `(1 − αλ₂)²` per step, governed by `λ₂(L_F)`, the spectral gap. Its zero set is precisely the **global sections** of the sheaf:

```
{ x : f(x) = 0 } = ker(δ) = H⁰(G; F)
```

that is, the states where all connected roles agree on their shared observed subspace. This is the propagation-layer analogue of the semantic-layer finality gap vector returning zero.

### 7.2 Why not the variance proxy Ω

Earlier revisions monitored the variance proxy `Ω(x) = Σᵢ ‖xᵢ − x̄‖²` (distance from the mean). That is only correct on the constant complete sheaf, where `f(x) = N · Ω(x)`. On a **projection sheaf** — the production default, where roles observe different dimensions — `Ω` and `f(x)` are not proportional. `Ω` counts disagreement on dimensions a role never observes and therefore can plateau above zero even when all *reachable* disagreement has vanished. Concretely, with two roles observing disjoint dimensions, `f(x) → 0` (they have nothing to disagree about) while `Ω` stays strictly positive. Gating finality on `Ω` in that regime makes RESOLVED either unreachable or spurious.

The engine therefore computes `f(x)` directly from the Laplacian it already materialises each step (near-zero extra cost), retains `Ω` only as a topology-health signal, and exposes a per-edge decomposition `‖δ_e x‖²` for bottleneck attribution (the highest-energy edge is the most-disagreeing role pair).

Source: [`sgrs-core/src/propagation/dirichlet.rs`](../sgrs-core/src/propagation/dirichlet.rs), surfaced via [`src/sgrsAdapter.ts`](../src/sgrsAdapter.ts) (`dirichletEnergy`, `dirichletEnergyByEdge`) and [`src/propagationEngine.ts`](../src/propagationEngine.ts) (`getDirichletEnergy`). Persisted per step in `propagation_history.dirichlet_after`.

---

## 8. Dual-condition finality (the ∧-gate)

RESOLVED requires **both** layers to certify simultaneously:

```
RESOLVED  ⟺  [ f(x) < ε_prop ]  ∧  F*(t)
             └ propagation layer ┘   └ semantic layer ┘
```

- `F*(t)` — vector finality: every required dimension independently meets its threshold within tolerance, with per-dimension gates and veto dimensions. Non-compensable.
- `f(x) < ε_prop` — the propagation layer has reached a global section (practical consensus among roles) within tolerance `ε_prop`.

The two conditions defend against two distinct failure modes. `F*` blocks the **compensation attack** (a weak dimension hidden by a strong one). The Dirichlet condition blocks **premature consensus** (declaring done while roles still structurally disagree). Neither subsumes the other.

**Backward compatibility.** The propagation condition is additive and guarded: when `dirichlet_gate.enabled` is false, or when no propagation history exists for the scope, it defaults to `true`, so the gate reduces to the semantic layer alone. When the condition holds up RESOLVED, the evaluator emits a `dirichlet_hold` signal (semantics ready, propagation still converging) for observability.

Configuration in `finality.yaml`:

```yaml
dirichlet_gate:
  enabled: true
  epsilon_prop: 0.01   # practical-stability threshold on f(x)
```

Source: [`src/finalityEvaluator.ts`](../src/finalityEvaluator.ts) (`propConverged`, `dirichlet_gate`), [`migrations/025_propagation_history_dirichlet.sql`](../migrations/025_propagation_history_dirichlet.sql).

---

## 9. References

1. **Olfati-Saber, R. & Murray, R. M.** (2004). Consensus Problems in Networks of Agents With Switching Topology and Time-Delays. *IEEE Transactions on Automatic Control*, 49(9), 1520--1533. doi:[10.1109/TAC.2004.834113](https://doi.org/10.1109/TAC.2004.834113)
   -- Lyapunov stability framework for multi-agent consensus. Foundation for the disagreement function V(t) and the convergence guarantee: if V is a common Lyapunov function that decreases along system trajectories, the system converges to consensus.

2. **Ruan, C., Wang, Y., Shi, Z., & Li, J.** (2025). Reaching Agreement Among Reasoning LLM Agents. *arXiv preprint* arXiv:[2512.20184](https://arxiv.org/abs/2512.20184)
   -- Multi-agent reasoning consensus; Aegean protocol with incremental quorum convergence and refinement monotonicity. We adapt their monotonicity principle as the monotonicity gate for the goal score.

3. **Camacho, D. et al.** (2024). MACI: Multi-Agent Collective Intelligence. *arXiv preprint* arXiv:[2510.04488](https://arxiv.org/abs/2510.04488)
   -- EMA-based stagnation detection for multi-agent systems. The MACI framework uses progress ratio monitoring to detect when collective improvement has stalled; we adapt their approach for plateau detection in the finality gradient.

4. **Laddad, S., Cheung, A., & Hellerstein, J. M.** (2022). Keep CALM and CRDT On. *arXiv preprint* arXiv:[2210.12605](https://arxiv.org/abs/2210.12605) (VLDB 2023).
   -- CRDT monotonic merge operations. The principle that merge must be commutative, associative, and idempotent underlies our monotonic graph upserts.

5. **Dorigo, M., Theraulaz, G., & Trianni, V.** (2024). Swarm Intelligence: Past, Present, and Future. *Proceedings of the Royal Society B*, 291(2024). doi:[10.1098/rspb.2024.0856](https://doi.org/10.1098/rspb.2024.0856)
   -- Stigmergic coordination in biological and artificial swarms. Agents respond to environmental gradients (pheromone trails) rather than direct communication. Pressure-directed activation adapts this: the convergence pressure map serves as the gradient signal.

---

*Source files: [`src/convergenceTracker.ts`](../src/convergenceTracker.ts), [`src/finalityEvaluator.ts`](../src/finalityEvaluator.ts), [`src/hitlFinalityRequest.ts`](../src/hitlFinalityRequest.ts), [`finality.yaml`](../finality.yaml), [`scripts/benchmark-convergence.ts`](../scripts/benchmark-convergence.ts), [`test/unit/convergenceTracker.test.ts`](../test/unit/convergenceTracker.test.ts).*
