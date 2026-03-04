# Proposed Experimental Protocol

> Back to [README](../README.md) | See also [publication/swarm-governed-agents.tex](../publication/swarm-governed-agents.tex) Section 9, [validation.md](validation.md)

The paper defines five experimental protocols designed to address open questions in the literature---particularly those identified by de la Chica Rodriguez and Vera Diaz (SECP). These experiments are **designed to be reproducible** using the reference implementation.

**Implementation:** Seed scripts, drivers, result collection, and analysis are in place. Run via `./scripts/run-experiment.sh exp<N>` or batch with `./scripts/run-experiment-batch.sh`. See [docs/experiments/README.md](experiments/README.md) for per-experiment setup and result locations.

| Experiment | GitHub Issue |
|------------|--------------|
| 1. Convergence dynamics | [#12](https://github.com/DealExMachina/swarm-of-governed-agents/issues/12) |
| 2. Scalability | [#13](https://github.com/DealExMachina/swarm-of-governed-agents/issues/13) |
| 3. Finality robustness | [#14](https://github.com/DealExMachina/swarm-of-governed-agents/issues/14) |
| 4. Multi-level governance | [#15](https://github.com/DealExMachina/swarm-of-governed-agents/issues/15) |
| 5. Coverage-autonomy trade-off | [#16](https://github.com/DealExMachina/swarm-of-governed-agents/issues/16) |

---

## Experiment 1: Multi-Iteration Convergence Dynamics

**Goal:** Demonstrate multi-iteration convergence behavior that SECP explicitly could not evaluate (single-iteration design).

**Protocol:**

- Run 20 convergence cycles on a fixed scope with incremental context injection
- Vary contradiction density: 0, 1, 3, 5 contradictions per injection
- Measure: V(t) trajectory, alpha(t) convergence rate, gate satisfaction per round
- Report: convergence time (rounds to RESOLVED), V(t) monotonicity violations, oscillation frequency

**Expected outcome:** Characteristic trajectory shapes: exponential decay (easy cases), plateau-then-resolution (hard cases), oscillation-then-escalation (irreconcilable conflicts).

**Script:** Extend `scripts/benchmark-convergence.ts` or create `scripts/experiment-convergence-dynamics.ts`

---

## Experiment 2: Scalability

**Goal:** First empirical data on how governed agent coordination scales. Addresses SECP Section 8.6 item 4.

**Protocol:**

- Vary claims: 10, 50, 100, 500, 1000
- Vary contradiction rate: 10%, 30%, 50%
- Vary agent count: 3, 5, 7, 12
- Fixed: governance mode (YOLO), finality thresholds
- Measure: rounds to convergence, wall-clock time, LLM token consumption, audit event count

**Expected outcome:** Identification of scaling bottleneck (likely contradiction resolution, not claim extraction); empirical validation of O(n * k) complexity bound.

**Script:** Create `scripts/experiment-scalability.ts`

---

## Experiment 3: Finality Robustness

**Goal:** Demonstrate that the 5-gate mechanism prevents false finality under adversarial conditions.

**Protocol:**

- Inject adversarial evidence patterns:
  - Spike-and-drop: sudden high confidence followed by contradiction
  - Oscillating claims: alternating contradictory evidence
  - Stale evidence: exceeds max_age_days during convergence
  - Empty scope: trivial initialization
- Measure: false finality rate (RESOLVED despite unresolved contradictions), gate trigger frequency, ESCALATED rate

**Expected outcome:** Gate C (oscillation detection) catches patterns simple thresholds miss; Gate B (evidence freshness) blocks finality on stale data.

**Script:** Extend `scripts/benchmark-convergence.ts` or create `scripts/experiment-finality-robustness.ts`

---

## Experiment 4: Multi-Level Governance

**Goal:** Demonstrate governance at multiple levels, extending both our and SECP's single-level models.

**Protocol:**

- Define 3 governance levels:
  - Level 1 (Operational): YOLO mode, per-agent activation filters
  - Level 2 (Compliance): MITL mode, drift-triggered rules
  - Level 3 (Regulatory): MASTER mode, immutable invariants
- Run M&A scenario with cross-level escalation:
  - Financial claims escalate L1 to L2 on contradiction
  - Patent disputes escalate L2 to L3
  - L3 decisions immutable (cannot be overridden)
- Measure: decision distribution across levels, escalation frequency, time-to-finality per level

**Expected outcome:** >80% of decisions resolved at operational level; L3 decisions rare but critical; separation of duties traceable through certificate chain.

**Script:** Create `scripts/experiment-governance-levels.ts`

---

## Experiment 5: Coverage-Autonomy Trade-off

**Goal:** Empirically map the coverage-autonomy trade-off that SECP identified, using governance modes as the control variable.

**Protocol:**

- Run identical document set through 3 governance modes: YOLO, MITL, MASTER
- Measure: claims accepted, contradictions resolved autonomously, human escalations, convergence rate alpha
- Map to SECP framework: YOLO ~ scalar aggregation (high coverage), MASTER ~ hard veto (low coverage), MITL ~ intermediate

**Expected outcome:** Lyapunov convergence rate alpha differs characteristically across modes, providing a formal metric for the trade-off SECP identified empirically.

**Script:** Create `scripts/experiment-coverage-autonomy.ts`

---

## Noisy corpus (noisy)

**Goal:** Test behaviour on ambiguous/hedging documents (noisy corpus) as noted in the paper's internal validity and future work.

**Protocol:**

- Use corpus from `demo/scenario/docs-noisy` (5 documents with ambiguous language).
- Run with same hatchery and simulate-mitl as exp4; collect convergence history and decision records.
- Measure: V(t), resolution rate, finality, pipeline progression.

**Run:** `./scripts/run-experiment.sh noisy`. Results: `docs/experiments/noisy/results/<timestamp>`.

---

## Financial Consolidation (financial)

**Goal:** Demonstrate that the bitemporal semantic graph correctly handles multi-period financial statement reconciliation -- where dual temporality (valid time vs. transaction time) is structurally necessary, restatements supersede earlier figures, and accounting methodology differences create genuine (not artifactual) ambiguity.

**Protocol:**

- Use corpus from `demo/scenario/docs-financial` (8 documents: 1 consolidated summary, 3 subsidiary reports, 1 restatement, 1 cross-period comparative, 1 auditor review, 1 management response).
- Documents arrive sequentially but reference overlapping and distinct valid-time windows (Q1 2025, Q2 2025, H1 2025). Document 5 (Alpha restated, tx May 22) supersedes document 2 (Alpha original, tx April 14) for the same valid period.
- Contradictions span three categories: hard numerical disagreements (revenue, margin, headcount), temporal restatements (same valid time, later transaction time), and methodology-dependent ambiguity (ranges, classification judgment).
- Run with hatchery and simulate-mitl; collect convergence history and decision records.
- Measure: V(t) trajectory (expected non-monotonic: rise on contradiction arrival, partial decrease on restatement, re-rise on auditor observations), gate satisfaction (especially Gate B on stale evidence and Gate C on oscillation), temporal supersession correctness, finality state.

**Expected outcome:** Characteristic non-monotonic V(t) trajectory distinct from clean demo (few contradictions) and noisy corpus (ambiguity without temporal structure). Gate B should fire on stale original figures after restatement. Final state: ESCALATED due to unresolved classification issues (equity vs. loan, methodology alignment).

**Run:** `./scripts/run-experiment.sh financial --rounds=8`. Results: `docs/experiments/financial/results/<timestamp>`. See [docs/experiments/financial/README.md](experiments/financial/README.md) for the full contradiction and ambiguity map.

---

## Relationship to Existing Benchmarks

The **7 convergence benchmark scenarios** in `scripts/benchmark-convergence.ts` validate mathematical properties with pure math (no Docker, no LLM):

| Scenario | Outcome |
|----------|---------|
| Steady convergence (~5%/round) | Monotonic, converging |
| Plateau at 0.70 | Stagnation detected |
| Spike-and-drop | Monotonicity gate blocks premature finality |
| Divergence | Negative alpha, zero forward progress |
| One-dimension bottleneck | Pressure identifies blocker |
| Fast convergence | No false plateau |
| Empty graph | Safe defaults |

These benchmarks are a prerequisite for Experiments 1 and 3. The full experiments require Docker, LLM, and end-to-end pipeline execution.

### sgrs load benchmark (unified governance)

**Goal:** Show that multiple concurrent instances can share a single governance config and that the sgrs (Rust) kernel sustains high throughput with deterministic decisions.

**Protocol:**

- Load one governance config (e.g. `governance.yaml`) once; run N concurrent workers (instances).
- Each worker repeatedly calls sgrs: kernel, transition, rules, gates, convergence (mix configurable).
- Measure: throughput (ops/s), latency (p50/p95/p99) per operation, and consistency (same input yields same output across all instances).

**Run:**

```bash
npx tsx scripts/benchmark-sgrs-load.ts
npx tsx scripts/benchmark-sgrs-load.ts --instances=8 --duration=10 --mix=both
npx tsx scripts/benchmark-sgrs-load.ts --instances=4 --ops=50000
```

**Options:** `--instances=N`, `--duration=N`, `--ops=N`, `--mix=governance|finality|both`.

**Expected outcome:** High throughput (order of 10^5 ops/s depending on hardware), sub-millisecond latencies, and "Unified governance: all instances produced identical outputs for same inputs."

---

## Load and Variational Experiment (exp-load)

**Goal:** Stress-test state graph, progression, and finality under load with factorial variation.

**Protocol:**

- Vary context injection rate: baseline (20s), fast (5s), stress (2s), burst
- Vary graph size: small (50 claims, rho=0.1), medium (200, 0.2), large (500, 0.3)
- Vary agent scaling: default vs scaled (2x workers)
- Measure: CAS rejections, state transitions/min, bootstrap-to-first-transition, V(t) monotonicity

**Scripts:** `scripts/loadgen-inject.ts`, `scripts/run-load-experiment.sh`. See [docs/experiments/exp-load/README.md](experiments/exp-load/README.md).
